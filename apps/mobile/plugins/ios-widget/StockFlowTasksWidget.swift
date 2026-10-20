import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Data Models

struct WidgetTaskItem: Codable, Identifiable {
    let id: Int
    let title: String
    let timeFormatted: String
    let dateFormatted: String?
    let priority: String?
    let isCompleted: Bool
}

struct WidgetDayData: Codable {
    let total: Int
    let completed: Int?
    let percent: Int?
    let tasks: [WidgetTaskItem]
}

struct StockFlowWidgetSnapshot: Codable {
    let installationId: String?
    let updatedAt: String?
    let overallPercent: Int?
    let today: WidgetDayData?
    let tomorrow: WidgetDayData?
    let upcoming7Days: WidgetDayData?
}

struct TaskEntry: TimelineEntry {
    let date: Date
    let snapshot: StockFlowWidgetSnapshot
    let isSampleData: Bool
    let isStale: Bool
}

// MARK: - App Intent for Interactive Task Completion (iOS 17+)

@available(iOS 17.0, *)
struct ToggleTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Toggle Task Completion"
    static var description = IntentDescription("Toggles task completion status in StockFlow.")

    @Parameter(title: "Task ID")
    var taskId: Int

    @Parameter(title: "Target Completion State")
    var targetCompleted: Bool

    init() {
        self.taskId = 0
        self.targetCompleted = false
    }

    init(taskId: Int, targetCompleted: Bool) {
        self.taskId = taskId
        self.targetCompleted = targetCompleted
    }

    func perform() async throws -> some IntentResult {
        let suiteName = "group.com.sparke27.mobile"
        guard let sharedDefaults = UserDefaults(suiteName: suiteName) else {
            return .result()
        }

        // 1. Queue action reliably in App Group UserDefaults
        var pending = (sharedDefaults.array(forKey: "stockflow_pending_actions") as? [[String: Any]]) ?? []

        // Prevent repeated rapid taps from corrupting task state:
        // If an action for this exact taskId and target state is already queued, do not duplicate
        if let lastAction = pending.last(where: { ($0["taskId"] as? Int) == taskId }),
           let lastTarget = lastAction["targetCompleted"] as? Bool,
           lastTarget == targetCompleted {
            // Already queued for this target state
        } else {
            let actionItem: [String: Any] = [
                "id": UUID().uuidString,
                "taskId": taskId,
                "action": "toggle",
                "targetCompleted": targetCompleted,
                "timestamp": ISO8601DateFormatter().string(from: Date())
            ]
            pending.append(actionItem)
            sharedDefaults.set(pending, forKey: "stockflow_pending_actions")
        }

        // 2. Optimistically update cached snapshot in App Group so the widget immediately reflects the change
        if let rawJson = sharedDefaults.string(forKey: "stockflow_widget_snapshot"),
           let data = rawJson.data(using: .utf8),
           var snapshot = try? JSONDecoder().decode(StockFlowWidgetSnapshot.self, from: data) {

            var todayTasks = snapshot.today?.tasks ?? []
            if let idx = todayTasks.firstIndex(where: { $0.id == taskId }) {
                let current = todayTasks[idx]
                let updatedTask = WidgetTaskItem(
                    id: current.id,
                    title: current.title,
                    timeFormatted: current.timeFormatted,
                    dateFormatted: current.dateFormatted,
                    priority: current.priority,
                    isCompleted: targetCompleted
                )
                todayTasks[idx] = updatedTask
                let newCompleted = todayTasks.filter { $0.isCompleted }.count
                let total = todayTasks.count
                let newPercent = total > 0 ? Int(round(Double(newCompleted) / Double(total) * 100.0)) : 0
                let updatedToday = WidgetDayData(
                    total: total,
                    completed: newCompleted,
                    percent: newPercent,
                    tasks: todayTasks
                )
                snapshot = StockFlowWidgetSnapshot(
                    installationId: snapshot.installationId,
                    updatedAt: ISO8601DateFormatter().string(from: Date()),
                    overallPercent: newPercent,
                    today: updatedToday,
                    tomorrow: snapshot.tomorrow,
                    upcoming7Days: snapshot.upcoming7Days
                )
                if let updatedData = try? JSONEncoder().encode(snapshot),
                   let updatedStr = String(data: updatedData, encoding: .utf8) {
                    sharedDefaults.set(updatedStr, forKey: "stockflow_widget_snapshot")
                    if let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: suiteName) {
                        let fileURL = containerURL.appendingPathComponent("stockflow_widget_snapshot.json")
                        try? updatedStr.write(to: fileURL, atomically: true, encoding: .utf8)
                    }
                }
            }
        }
        sharedDefaults.synchronize()

        // 3. Reload timelines immediately
        WidgetCenter.shared.reloadAllTimelines()

        return .result()
    }
}

// MARK: - Timeline Provider

struct TaskTimelineProvider: TimelineProvider {
    typealias Entry = TaskEntry

    func placeholder(in context: Context) -> TaskEntry {
        TaskEntry(date: Date(), snapshot: emptySnapshot(), isSampleData: false, isStale: false)
    }

    func getSnapshot(in context: Context, completion: @escaping (TaskEntry) -> Void) {
        let entry = loadSnapshot()
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TaskEntry>) -> Void) {
        let entry = loadSnapshot()
        let now = Date()
        let calendar = Calendar.current

        let in5Seconds = now.addingTimeInterval(5)
        let nextMidnight = calendar.startOfDay(
            for: calendar.date(byAdding: .day, value: 1, to: now) ?? now.addingTimeInterval(86400)
        ).addingTimeInterval(1)
        let nextUpdate = min(in5Seconds, nextMidnight)

        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }

    // MARK: - Private helpers

    private func emptySnapshot() -> StockFlowWidgetSnapshot {
        StockFlowWidgetSnapshot(
            installationId: nil,
            updatedAt: nil,
            overallPercent: 0,
            today: WidgetDayData(total: 0, completed: 0, percent: 0, tasks: []),
            tomorrow: WidgetDayData(total: 0, completed: 0, percent: 0, tasks: []),
            upcoming7Days: WidgetDayData(total: 0, completed: 0, percent: 0, tasks: [])
        )
    }

    /// Reads live data from the shared App Group.
    /// If App Group is unavailable, corrupted, or empty, safely returns an empty state.
    /// Never interprets a failed read as an empty write to persistent storage.
    private func loadSnapshot() -> TaskEntry {
        let suites = [
            "group.com.sparke27.mobile",
            "group.com.sparke27.StockFlow",
            "group.mobile"
        ]
        var jsonString: String?

        // Primary: UserDefaults App Group suites
        for suiteName in suites {
            if let sharedDefaults = UserDefaults(suiteName: suiteName) {
                let candidate = sharedDefaults.string(forKey: "stockflow_widget_snapshot")
                if let s = candidate, !s.isEmpty {
                    jsonString = s
                    break
                }
            }
        }

        // Fallback: App Group container files (written by the bridge as redundant backup)
        if jsonString == nil {
            for suiteName in suites {
                if let containerURL = FileManager.default.containerURL(
                    forSecurityApplicationGroupIdentifier: suiteName
                ) {
                    let fileURL = containerURL.appendingPathComponent("stockflow_widget_snapshot.json")
                    if let s = try? String(contentsOf: fileURL, encoding: .utf8), !s.isEmpty {
                        jsonString = s
                        break
                    }
                }
            }
        }

        guard let rawJson = jsonString, !rawJson.isEmpty,
              let data = rawJson.data(using: .utf8),
              let snapshot = try? JSONDecoder().decode(StockFlowWidgetSnapshot.self, from: data)
        else {
            // App Group unavailable, corrupted, or no data written yet:
            // Return safe empty snapshot without touching storage.
            return TaskEntry(date: Date(), snapshot: emptySnapshot(), isSampleData: false, isStale: false)
        }

        var isStale = false
        var effectiveSnapshot = snapshot

        if let updatedStr = snapshot.updatedAt,
           let updatedDate = ISO8601DateFormatter().date(from: updatedStr) {
            let calendar = Calendar.current
            if !calendar.isDateInToday(updatedDate) {
                isStale = true
                // Automatic midnight rollover: promote yesterday's "tomorrow" tasks to today
                let yesterday = calendar.date(byAdding: .day, value: -1, to: Date())
                    ?? Date().addingTimeInterval(-86400)
                if calendar.isDate(updatedDate, inSameDayAs: yesterday),
                   let tomorrowData = snapshot.tomorrow,
                   tomorrowData.total > 0 {
                    let rolledToday = WidgetDayData(
                        total: tomorrowData.total,
                        completed: 0,
                        percent: 0,
                        tasks: tomorrowData.tasks.map { task in
                            WidgetTaskItem(
                                id: task.id,
                                title: task.title,
                                timeFormatted: task.timeFormatted,
                                dateFormatted: "Today",
                                priority: task.priority,
                                isCompleted: false
                            )
                        }
                    )
                    effectiveSnapshot = StockFlowWidgetSnapshot(
                        installationId: snapshot.installationId,
                        updatedAt: snapshot.updatedAt,
                        overallPercent: 0,
                        today: rolledToday,
                        tomorrow: nil,
                        upcoming7Days: snapshot.upcoming7Days
                    )
                    isStale = false
                }
            }
        }

        return TaskEntry(date: Date(), snapshot: effectiveSnapshot, isSampleData: false, isStale: isStale)
    }
}

// MARK: - Shared Accent & Background Colors

private let accentBlue = Color(red: 0.22, green: 0.74, blue: 0.97)
private let bgDark     = Color(red: 0.06, green: 0.09, blue: 0.16)

// MARK: - Entry Views (widget-family router)

struct StockFlowTasksWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    var entry: TaskTimelineProvider.Entry

    var body: some View {
        Group {
            switch family {
            case .systemSmall:
                SmallWidgetView(entry: entry)
            default:
                MediumWidgetView(entry: entry)
            }
        }
        .widgetURL(URL(string: "mobile://tasks?view=today"))
    }
}

// MARK: - Small Widget (2×2)

struct SmallWidgetView: View {
    var entry: TaskTimelineProvider.Entry

    var body: some View {
        let today     = entry.snapshot.today
        let tasks     = today?.tasks ?? []
        let total     = today?.total ?? 0
        let completed = today?.completed ?? 0
        let percent   = today?.percent ?? 0

        VStack(alignment: .leading, spacing: 6) {
            // Header
            HStack {
                HStack(spacing: 4) {
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(accentBlue)
                    Text("Tasks")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(accentBlue)
                }
                Spacer()
                Link(destination: URL(string: "mobile://tasks?action=new")!) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(accentBlue)
                }
                if total > 0 {
                    Text("\(completed)/\(total)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.secondary)
                }
            }

            // Progress bar
            if total > 0 {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Color(white: 0.25))
                            .frame(height: 4)
                        RoundedRectangle(cornerRadius: 3)
                            .fill(percent == 100 ? Color.green : accentBlue)
                            .frame(
                                width: max(4, geo.size.width * CGFloat(percent) / 100.0),
                                height: 4
                            )
                    }
                }
                .frame(height: 4)
            }

            // Body
            if total == 0 {
                Spacer()
                VStack(alignment: .leading, spacing: 3) {
                    Text("All Caught Up")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.primary)
                    Text("No tasks today")
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                    Link(destination: URL(string: "mobile://tasks?action=new")!) {
                        HStack(spacing: 3) {
                            Image(systemName: "plus")
                                .font(.system(size: 8, weight: .bold))
                            Text("Add Task")
                                .font(.system(size: 9, weight: .bold))
                        }
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(accentBlue.opacity(0.2))
                        .clipShape(Capsule())
                        .foregroundStyle(accentBlue)
                    }
                }
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(tasks.prefix(2)) { task in
                        HStack(spacing: 5) {
                            if #available(iOS 17.0, *) {
                                Button(intent: ToggleTaskIntent(taskId: task.id, targetCompleted: !task.isCompleted)) {
                                    Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(task.isCompleted ? Color.green : accentBlue)
                                }
                                .buttonStyle(.plain)
                            } else {
                                Link(destination: URL(string: "mobile://tasks?action=toggle&taskId=\(task.id)")!) {
                                    Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(task.isCompleted ? Color.green : accentBlue)
                                }
                            }

                            Text(task.title)
                                .font(.system(size: 10))
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                                .foregroundStyle(task.isCompleted ? .secondary : .primary)

                            Spacer(minLength: 0)

                            Link(destination: URL(string: "mobile://tasks?action=edit&taskId=\(task.id)")!) {
                                Image(systemName: "pencil")
                                    .font(.system(size: 9))
                                    .foregroundStyle(accentBlue)
                            }
                        }
                    }
                    if total > 2 {
                        Text("+ \(total - 2) more")
                            .font(.system(size: 8, weight: .medium))
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(12)
        .widgetBackground(bgDark)
    }
}

// MARK: - Medium Widget (4×2)

struct MediumWidgetView: View {
    var entry: TaskTimelineProvider.Entry

    var body: some View {
        let today          = entry.snapshot.today
        let tasks          = today?.tasks ?? []
        let total          = today?.total ?? 0
        let completed      = today?.completed ?? 0
        let percent        = today?.percent ?? 0
        let remainingCount = max(0, total - 3)

        VStack(alignment: .leading, spacing: 6) {
            // Header
            HStack {
                HStack(spacing: 4) {
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(accentBlue)
                    Text("StockFlow Tasks")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(accentBlue)
                }

                Link(destination: URL(string: "mobile://tasks?action=new")!) {
                    HStack(spacing: 2) {
                        Image(systemName: "plus")
                            .font(.system(size: 9, weight: .bold))
                        Text("Add")
                            .font(.system(size: 10, weight: .bold))
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(accentBlue.opacity(0.2))
                    .clipShape(Capsule())
                    .foregroundStyle(accentBlue)
                }

                Spacer()
                Group {
                    if entry.isStale {
                        Text("⚠️ Tap to sync")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.orange)
                    } else if total > 0 {
                        Text("\(completed)/\(total) Done (\(percent)%)")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Color(white: 0.9))
                    } else {
                        Text("Today")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                }
            }

            // Progress bar
            if total > 0 {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Color(white: 0.2))
                            .frame(height: 5)
                        RoundedRectangle(cornerRadius: 3)
                            .fill(percent == 100 ? Color.green : accentBlue)
                            .frame(
                                width: max(5, geo.size.width * CGFloat(percent) / 100.0),
                                height: 5
                            )
                    }
                }
                .frame(height: 5)
            }

            // Body
            if total == 0 {
                Spacer()
                HStack {
                    Spacer()
                    VStack(spacing: 4) {
                        Image(systemName: "checklist")
                            .font(.system(size: 18))
                            .foregroundStyle(.secondary)
                        Text("No tasks scheduled for today")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color(white: 0.8))
                            .multilineTextAlignment(.center)
                        Link(destination: URL(string: "mobile://tasks?action=new")!) {
                            HStack(spacing: 4) {
                                Image(systemName: "plus.circle.fill")
                                    .font(.system(size: 12, weight: .bold))
                                Text("Add Task")
                                    .font(.system(size: 11, weight: .bold))
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(accentBlue.opacity(0.25))
                            .clipShape(Capsule())
                            .foregroundStyle(accentBlue)
                        }
                    }
                    Spacer()
                }
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(tasks.prefix(3)) { task in
                        HStack(spacing: 6) {
                            if #available(iOS 17.0, *) {
                                Button(intent: ToggleTaskIntent(taskId: task.id, targetCompleted: !task.isCompleted)) {
                                    Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                                        .font(.system(size: 11, weight: .bold))
                                        .foregroundStyle(task.isCompleted ? Color.green : accentBlue)
                                }
                                .buttonStyle(.plain)
                            } else {
                                Link(destination: URL(string: "mobile://tasks?action=toggle&taskId=\(task.id)")!) {
                                    Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                                        .font(.system(size: 11, weight: .bold))
                                        .foregroundStyle(task.isCompleted ? Color.green : accentBlue)
                                }
                            }

                            Text(task.title)
                                .font(.system(size: 11, weight: .medium))
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                                .foregroundStyle(task.isCompleted ? .secondary : Color(white: 0.95))

                            Spacer(minLength: 0)

                            if !task.timeFormatted.isEmpty && task.timeFormatted != "--:--" {
                                Text(task.timeFormatted)
                                    .font(.system(size: 10, weight: .regular))
                                    .foregroundStyle(.secondary)
                            }

                            Link(destination: URL(string: "mobile://tasks?action=edit&taskId=\(task.id)")!) {
                                HStack(spacing: 2) {
                                    Image(systemName: "pencil")
                                        .font(.system(size: 9, weight: .medium))
                                    Text("Edit")
                                        .font(.system(size: 9, weight: .medium))
                                }
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .background(Color(white: 0.18))
                                .cornerRadius(4)
                                .foregroundStyle(accentBlue)
                            }
                        }
                    }

                    if remainingCount > 0 {
                        Text("+ \(remainingCount) more task\(remainingCount == 1 ? "" : "s") today")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(.secondary)
                            .padding(.top, 1)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(12)
        .widgetBackground(bgDark)
    }
}

// MARK: - Upcoming Widget Entry Views

struct StockFlowUpcomingWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    var entry: TaskTimelineProvider.Entry

    var body: some View {
        Group {
            switch family {
            case .systemSmall:
                UpcomingSmallWidgetView(entry: entry)
            default:
                UpcomingMediumWidgetView(entry: entry)
            }
        }
        .widgetURL(URL(string: "mobile://tasks?view=upcoming"))
    }
}

// MARK: - Upcoming Small Widget (2×2)

struct UpcomingSmallWidgetView: View {
    var entry: TaskTimelineProvider.Entry

    var body: some View {
        let upcoming = entry.snapshot.upcoming7Days ?? entry.snapshot.tomorrow
        let tasks    = upcoming?.tasks ?? []
        let total    = upcoming?.total ?? tasks.count

        VStack(alignment: .leading, spacing: 6) {
            // Header
            HStack {
                HStack(spacing: 4) {
                    Image(systemName: "calendar.badge.clock")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(accentBlue)
                    Text("Upcoming")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(accentBlue)
                }
                Spacer()
                Link(destination: URL(string: "mobile://tasks?action=new")!) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(accentBlue)
                }
                if total > 0 {
                    Text("\(total)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.secondary)
                }
            }

            // Body
            if total == 0 {
                Spacer()
                VStack(alignment: .leading, spacing: 3) {
                    Text("Clear Horizon")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.primary)
                    Text("No upcoming tasks")
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                    Link(destination: URL(string: "mobile://tasks?action=new")!) {
                        HStack(spacing: 3) {
                            Image(systemName: "plus")
                                .font(.system(size: 8, weight: .bold))
                            Text("Add Task")
                                .font(.system(size: 9, weight: .bold))
                        }
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(accentBlue.opacity(0.2))
                        .clipShape(Capsule())
                        .foregroundStyle(accentBlue)
                    }
                }
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(tasks.prefix(2)) { task in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(task.title)
                                .font(.system(size: 10, weight: .medium))
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                                .foregroundStyle(.primary)
                            HStack(spacing: 4) {
                                if let dateLabel = task.dateFormatted, !dateLabel.isEmpty {
                                    Text(dateLabel)
                                        .font(.system(size: 8, weight: .semibold))
                                        .foregroundStyle(accentBlue)
                                }
                                if !task.timeFormatted.isEmpty && task.timeFormatted != "--:--" {
                                    Text(task.timeFormatted)
                                        .font(.system(size: 8))
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    if total > 2 {
                        Text("+ \(total - 2) more")
                            .font(.system(size: 8, weight: .medium))
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(12)
        .widgetBackground(bgDark)
    }
}

// MARK: - Upcoming Medium Widget (4×2)

struct UpcomingMediumWidgetView: View {
    var entry: TaskTimelineProvider.Entry

    var body: some View {
        let upcoming       = entry.snapshot.upcoming7Days ?? entry.snapshot.tomorrow
        let tasks          = upcoming?.tasks ?? []
        let total          = upcoming?.total ?? tasks.count
        let remainingCount = max(0, total - 3)

        VStack(alignment: .leading, spacing: 6) {
            // Header
            HStack {
                HStack(spacing: 4) {
                    Image(systemName: "calendar.badge.clock")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(accentBlue)
                    Text("StockFlow Upcoming")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(accentBlue)
                }

                Link(destination: URL(string: "mobile://tasks?action=new")!) {
                    HStack(spacing: 2) {
                        Image(systemName: "plus")
                            .font(.system(size: 9, weight: .bold))
                        Text("Add")
                            .font(.system(size: 10, weight: .bold))
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(accentBlue.opacity(0.2))
                    .clipShape(Capsule())
                    .foregroundStyle(accentBlue)
                }

                Spacer()
                if total > 0 {
                    Text("\(total) Scheduled")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Color(white: 0.9))
                } else {
                    Text("Next 7 Days")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
            }

            // Body
            if total == 0 {
                Spacer()
                HStack {
                    Spacer()
                    VStack(spacing: 4) {
                        Image(systemName: "calendar")
                            .font(.system(size: 18))
                            .foregroundStyle(.secondary)
                        Text("No upcoming tasks scheduled")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color(white: 0.8))
                            .multilineTextAlignment(.center)
                        Link(destination: URL(string: "mobile://tasks?action=new")!) {
                            HStack(spacing: 4) {
                                Image(systemName: "plus.circle.fill")
                                    .font(.system(size: 12, weight: .bold))
                                Text("Add Task")
                                    .font(.system(size: 11, weight: .bold))
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(accentBlue.opacity(0.25))
                            .clipShape(Capsule())
                            .foregroundStyle(accentBlue)
                        }
                    }
                    Spacer()
                }
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(tasks.prefix(3)) { task in
                        HStack(spacing: 6) {
                            Circle()
                                .fill(
                                    task.priority == "high" ? Color.red :
                                    task.priority == "low"  ? Color.gray : accentBlue
                                )
                                .frame(width: 6, height: 6)

                            Text(task.title)
                                .font(.system(size: 11, weight: .medium))
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                                .foregroundStyle(Color(white: 0.95))

                            Spacer(minLength: 0)

                            if let dateLabel = task.dateFormatted, !dateLabel.isEmpty {
                                Text(dateLabel)
                                    .font(.system(size: 10, weight: .semibold))
                                    .foregroundStyle(accentBlue)
                            }

                            if !task.timeFormatted.isEmpty && task.timeFormatted != "--:--" {
                                Text(task.timeFormatted)
                                    .font(.system(size: 10, weight: .regular))
                                    .foregroundStyle(.secondary)
                            }

                            Link(destination: URL(string: "mobile://tasks?action=edit&taskId=\(task.id)")!) {
                                Image(systemName: "pencil")
                                    .font(.system(size: 9, weight: .medium))
                                    .foregroundStyle(accentBlue)
                            }
                        }
                    }

                    if remainingCount > 0 {
                        Text("+ \(remainingCount) more upcoming task\(remainingCount == 1 ? "" : "s")")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(.secondary)
                            .padding(.top, 1)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(12)
        .widgetBackground(bgDark)
    }
}

// MARK: - iOS 16/17 containerBackground Compatibility

extension View {
    /// Applies WidgetKit-required `.containerBackground(_:for:)` on iOS 17+.
    /// On iOS 16.4 (minimum supported target), falls back to `.background()`.
    @ViewBuilder
    func widgetBackground(_ color: Color) -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(color, for: .widget)
        } else {
            self.background(color)
        }
    }
}

// MARK: - Widget Declarations

struct StockFlowTasksWidget: Widget {
    let kind: String = "StockFlowTasksWidget"

    var body: some WidgetConfiguration {
        let config = StaticConfiguration(kind: kind, provider: TaskTimelineProvider()) { entry in
            StockFlowTasksWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("StockFlow Tasks")
        .description("View today's scheduled tasks and completion progress.")
        .supportedFamilies([.systemSmall, .systemMedium])

        // contentMarginsDisabled() was introduced in iOS 17 / WidgetKit 2.0.
        // Guard it so the extension compiles and runs cleanly on iOS 16.4.
        if #available(iOS 17.0, *) {
            return config.contentMarginsDisabled()
        } else {
            return config
        }
    }
}

struct StockFlowUpcomingWidget: Widget {
    let kind: String = "StockFlowUpcomingWidget"

    var body: some WidgetConfiguration {
        let config = StaticConfiguration(kind: kind, provider: TaskTimelineProvider()) { entry in
            StockFlowUpcomingWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("StockFlow Upcoming Tasks")
        .description("Upcoming 7-day scheduled tasks.")
        .supportedFamilies([.systemSmall, .systemMedium])

        if #available(iOS 17.0, *) {
            return config.contentMarginsDisabled()
        } else {
            return config
        }
    }
}

// MARK: - Widget Bundle

@main
struct StockFlowWidgetBundle: WidgetBundle {
    @WidgetBundleBuilder
    var body: some Widget {
        StockFlowTasksWidget()
        StockFlowUpcomingWidget()
    }
}
