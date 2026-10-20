import WidgetKit
import SwiftUI

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
    /// `true` when snapshot is synthesised sample data (App Group inaccessible or first install).
    /// Views use this to decide whether to show a "Tap to sync" badge.
    let isSampleData: Bool
    let isStale: Bool
}

// MARK: - Timeline Provider

struct TaskTimelineProvider: TimelineProvider {
    typealias Entry = TaskEntry

    func placeholder(in context: Context) -> TaskEntry {
        TaskEntry(date: Date(), snapshot: sampleSnapshot(), isSampleData: true, isStale: false)
    }

    func getSnapshot(in context: Context, completion: @escaping (TaskEntry) -> Void) {
        // Widget gallery picker always shows rich preview cards, never blank content
        if context.isPreview {
            completion(TaskEntry(date: Date(), snapshot: sampleSnapshot(), isSampleData: true, isStale: false))
            return
        }
        let entry = loadSnapshot()
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TaskEntry>) -> Void) {
        let entry = loadSnapshot()
        let now = Date()
        let calendar = Calendar.current

        // Refresh every 30 minutes OR at midnight rollover (whichever is earlier).
        // This is the maximum practical cadence – the OS may defer updates on Low Power Mode.
        let in30Minutes = calendar.date(byAdding: .minute, value: 30, to: now)
            ?? now.addingTimeInterval(1800)
        let nextMidnight = calendar.startOfDay(
            for: calendar.date(byAdding: .day, value: 1, to: now) ?? now.addingTimeInterval(86400)
        ).addingTimeInterval(1)
        let nextUpdate = min(in30Minutes, nextMidnight)

        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }

    // MARK: - Private helpers

    /// Attempts to read live data from the shared App Group.
    /// Returns a sample-data entry when the App Group is inaccessible (e.g. sideloading with
    /// a free Apple Developer account that cannot provision `group.com.sparke27.mobile`).
    private func loadSnapshot() -> TaskEntry {
        let suiteName = "group.com.sparke27.mobile"
        var jsonString: String?

        // Primary: UserDefaults App Group suite
        if let sharedDefaults = UserDefaults(suiteName: suiteName) {
            let candidate = sharedDefaults.string(forKey: "stockflow_widget_snapshot")
            if let s = candidate, !s.isEmpty { jsonString = s }
        }

        // Fallback: App Group container file (written by the bridge as redundant backup)
        if jsonString == nil {
            if let containerURL = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: suiteName
            ) {
                let fileURL = containerURL.appendingPathComponent("stockflow_widget_snapshot.json")
                jsonString = try? String(contentsOf: fileURL, encoding: .utf8)
            }
        }

        guard let rawJson = jsonString, !rawJson.isEmpty,
              let data = rawJson.data(using: .utf8),
              let snapshot = try? JSONDecoder().decode(StockFlowWidgetSnapshot.self, from: data)
        else {
            // App Group is inaccessible – fall back to sample data so the widget is always visible
            return TaskEntry(date: Date(), snapshot: sampleSnapshot(), isSampleData: true, isStale: false)
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

    private func sampleSnapshot() -> StockFlowWidgetSnapshot {
        StockFlowWidgetSnapshot(
            installationId: "sample",
            updatedAt: ISO8601DateFormatter().string(from: Date()),
            overallPercent: 67,
            today: WidgetDayData(
                total: 3,
                completed: 2,
                percent: 67,
                tasks: [
                    WidgetTaskItem(id: 1, title: "Morning Inventory Count",    timeFormatted: "09:00", dateFormatted: "Today",    priority: "high",   isCompleted: true),
                    WidgetTaskItem(id: 2, title: "Supplier Delivery Check",    timeFormatted: "13:30", dateFormatted: "Today",    priority: "medium", isCompleted: true),
                    WidgetTaskItem(id: 3, title: "Evening Restock Audit",      timeFormatted: "17:45", dateFormatted: "Today",    priority: "high",   isCompleted: false),
                ]
            ),
            tomorrow: WidgetDayData(
                total: 2,
                completed: 0,
                percent: 0,
                tasks: [
                    WidgetTaskItem(id: 4, title: "Receiving Pallet Stock", timeFormatted: "10:00", dateFormatted: "Tomorrow", priority: "medium", isCompleted: false),
                    WidgetTaskItem(id: 5, title: "Vendor SLA Review",      timeFormatted: "15:00", dateFormatted: "Tomorrow", priority: "high",   isCompleted: false),
                ]
            ),
            upcoming7Days: WidgetDayData(
                total: 4,
                completed: 0,
                percent: 0,
                tasks: [
                    WidgetTaskItem(id: 4, title: "Receiving Pallet Stock",     timeFormatted: "10:00", dateFormatted: "Tomorrow", priority: "medium", isCompleted: false),
                    WidgetTaskItem(id: 5, title: "Vendor SLA Review",          timeFormatted: "15:00", dateFormatted: "Tomorrow", priority: "high",   isCompleted: false),
                    WidgetTaskItem(id: 6, title: "Warehouse Safety Drill",     timeFormatted: "11:30", dateFormatted: "Friday",   priority: "low",    isCompleted: false),
                    WidgetTaskItem(id: 7, title: "Quarterly Stock Valuation",  timeFormatted: "09:00", dateFormatted: "Next Mon", priority: "high",   isCompleted: false),
                ]
            )
        )
    }
}

// MARK: - Shared accent colour

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
            // ── Header ──────────────────────────────────────────────
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
                if total > 0 {
                    Text("\(completed)/\(total)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.secondary)
                }
            }

            // ── Progress bar (only shown when there are tasks) ──────
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

            // ── Body ────────────────────────────────────────────────
            if total == 0 {
                Spacer()
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.isSampleData ? "Open StockFlow" : "All Caught Up")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.primary)
                    Text(entry.isSampleData ? "Tap to load tasks" : "No tasks today")
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                }
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(tasks.prefix(2)) { task in
                        HStack(spacing: 5) {
                            Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(task.isCompleted ? Color.green : accentBlue)
                            Text(task.title)
                                .font(.system(size: 10))
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                                .foregroundStyle(task.isCompleted ? .secondary : .primary)
                            Spacer(minLength: 0)
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
            // ── Header ──────────────────────────────────────────────
            HStack {
                HStack(spacing: 4) {
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(accentBlue)
                    Text("StockFlow Tasks")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(accentBlue)
                }
                Spacer()
                Group {
                    if entry.isStale {
                        Text("⚠️ Tap to sync")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.orange)
                    } else if entry.isSampleData {
                        Text("Preview")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(.secondary)
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

            // ── Progress bar ─────────────────────────────────────────
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

            // ── Body ─────────────────────────────────────────────────
            if total == 0 {
                Spacer()
                HStack {
                    Spacer()
                    VStack(spacing: 3) {
                        Image(systemName: entry.isSampleData ? "arrow.triangle.2.circlepath" : "checklist")
                            .font(.system(size: 18))
                            .foregroundStyle(.secondary)
                        Text(entry.isSampleData ? "Open StockFlow to sync tasks" : "No tasks scheduled for today")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color(white: 0.8))
                            .multilineTextAlignment(.center)
                        Text(entry.isSampleData ? "Tap to load your schedule" : "All caught up • Tap to open app")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    Spacer()
                }
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(tasks.prefix(3)) { task in
                        HStack(spacing: 6) {
                            Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(task.isCompleted ? Color.green : accentBlue)

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
            // ── Header ──────────────────────────────────────────────
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
                if total > 0 {
                    Text("\(total)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.secondary)
                }
            }

            // ── Body ─────────────────────────────────────────────────
            if total == 0 {
                Spacer()
                VStack(alignment: .leading, spacing: 2) {
                    Text("Clear Horizon")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.primary)
                    Text("No upcoming tasks")
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
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
            // ── Header ──────────────────────────────────────────────
            HStack {
                HStack(spacing: 4) {
                    Image(systemName: "calendar.badge.clock")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(accentBlue)
                    Text("StockFlow Upcoming")
                        .font(.system(size: 13, weight: .bold))
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

            // ── Body ─────────────────────────────────────────────────
            if total == 0 {
                Spacer()
                HStack {
                    Spacer()
                    VStack(spacing: 3) {
                        Image(systemName: "calendar")
                            .font(.system(size: 18))
                            .foregroundStyle(.secondary)
                        Text("No upcoming tasks scheduled")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color(white: 0.8))
                            .multilineTextAlignment(.center)
                        Text("Tasks scheduled for future days will appear here")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
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
    /// Applies the WidgetKit-required `.containerBackground(_:for:)` on iOS 17+.
    /// On iOS 16 (minimum supported target), falls back to a plain `.background()`.
    ///
    /// Both the app and the WidgetKit extension have `IPHONEOS_DEPLOYMENT_TARGET = 16.4`,
    /// which matches the expo-modules-core podspec minimum.
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
        // Guard it so the extension still compiles and runs cleanly on iOS 16.4.
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
