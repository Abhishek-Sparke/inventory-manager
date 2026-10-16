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
    let snapshot: StockFlowWidgetSnapshot?
    let isStale: Bool
}

// MARK: - Timeline Provider

struct TaskTimelineProvider: TimelineProvider {
    typealias Entry = TaskEntry

    func placeholder(in context: Context) -> TaskEntry {
        TaskEntry(date: Date(), snapshot: sampleSnapshot(), isStale: false)
    }

    func getSnapshot(in context: Context, completion: @escaping (TaskEntry) -> Void) {
        let entry = loadSnapshot()
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TaskEntry>) -> Void) {
        let entry = loadSnapshot()
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }

    private func loadSnapshot() -> TaskEntry {
        let suiteName = "group.com.sparke27.mobile"
        var jsonString: String? = nil

        if let sharedDefaults = UserDefaults(suiteName: suiteName) {
            jsonString = sharedDefaults.string(forKey: "stockflow_widget_snapshot")
        }

        if jsonString == nil || jsonString?.isEmpty == true {
            if let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: suiteName) {
                let fileURL = containerURL.appendingPathComponent("stockflow_widget_snapshot.json")
                jsonString = try? String(contentsOf: fileURL, encoding: .utf8)
            }
        }

        guard let rawJson = jsonString,
              let data = rawJson.data(using: .utf8),
              let snapshot = try? JSONDecoder().decode(StockFlowWidgetSnapshot.self, from: data) else {
            return TaskEntry(date: Date(), snapshot: nil, isStale: false)
        }

        var isStale = false
        if let updatedStr = snapshot.updatedAt,
           let updatedDate = ISO8601DateFormatter().date(from: updatedStr) {
            isStale = !Calendar.current.isDateInToday(updatedDate)
        }

        return TaskEntry(date: Date(), snapshot: snapshot, isStale: isStale)
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
                    WidgetTaskItem(id: 1, title: "Morning Inventory Count", timeFormatted: "09:00", dateFormatted: "Today", priority: "high", isCompleted: true),
                    WidgetTaskItem(id: 2, title: "Supplier Delivery Check", timeFormatted: "13:30", dateFormatted: "Today", priority: "medium", isCompleted: true),
                    WidgetTaskItem(id: 3, title: "Evening Restock Audit", timeFormatted: "17:45", dateFormatted: "Today", priority: "high", isCompleted: false)
                ]
            ),
            tomorrow: WidgetDayData(
                total: 2,
                completed: 0,
                percent: 0,
                tasks: [
                    WidgetTaskItem(id: 4, title: "Receiving Pallet Stock", timeFormatted: "10:00", dateFormatted: "Tomorrow", priority: "medium", isCompleted: false),
                    WidgetTaskItem(id: 5, title: "Vendor SLA Review", timeFormatted: "15:00", dateFormatted: "Tomorrow", priority: "high", isCompleted: false)
                ]
            ),
            upcoming7Days: WidgetDayData(
                total: 4,
                completed: 0,
                percent: 0,
                tasks: [
                    WidgetTaskItem(id: 4, title: "Receiving Pallet Stock", timeFormatted: "10:00", dateFormatted: "Tomorrow", priority: "medium", isCompleted: false),
                    WidgetTaskItem(id: 5, title: "Vendor SLA Review", timeFormatted: "15:00", dateFormatted: "Tomorrow", priority: "high", isCompleted: false),
                    WidgetTaskItem(id: 6, title: "Warehouse Safety Drill", timeFormatted: "11:30", dateFormatted: "Friday", priority: "low", isCompleted: false),
                    WidgetTaskItem(id: 7, title: "Quarterly Stock Valuation", timeFormatted: "09:00", dateFormatted: "Next Mon", priority: "high", isCompleted: false)
                ]
            )
        )
    }
}

// MARK: - SwiftUI Views for Today's Tasks Widget

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

// MARK: - Small Widget View (2x2)

struct SmallWidgetView: View {
    var entry: TaskTimelineProvider.Entry

    var body: some View {
        let today = entry.snapshot?.today
        let tasks = today?.tasks ?? []
        let total = today?.total ?? 0
        let completed = today?.completed ?? 0
        let percent = today?.percent ?? 0

        VStack(alignment: .leading, spacing: 6) {
            HStack {
                HStack(spacing: 4) {
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(Color(red: 0.22, green: 0.74, blue: 0.97))
                    Text("Tasks")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(Color(red: 0.22, green: 0.74, blue: 0.97))
                }
                Spacer()
                if total > 0 {
                    Text("\(completed)/\(total)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.secondary)
                }
            }

            if total > 0 {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Color(white: 0.25))
                            .frame(height: 4)
                        RoundedRectangle(cornerRadius: 3)
                            .fill(percent == 100 ? Color.green : Color(red: 0.22, green: 0.74, blue: 0.97))
                            .frame(width: max(4, geo.size.width * CGFloat(percent) / 100.0), height: 4)
                    }
                }
                .frame(height: 4)
            }

            if total == 0 {
                Spacer()
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.snapshot == nil ? "Open StockFlow" : "All Caught Up")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.primary)
                    Text(entry.snapshot == nil ? "Tap to load tasks" : "No tasks today")
                        .font(.system(size: 9))
                        .foregroundColor(.secondary)
                }
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(tasks.prefix(2)) { task in
                        HStack(spacing: 5) {
                            Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(task.isCompleted ? .green : Color(red: 0.22, green: 0.74, blue: 0.97))
                            Text(task.title)
                                .font(.system(size: 10))
                                .lineLimit(1)
                                .foregroundColor(task.isCompleted ? .secondary : .primary)
                            Spacer()
                        }
                    }
                    if total > 2 {
                        Text("+ \(total - 2) more")
                            .font(.system(size: 8, weight: .medium))
                            .foregroundColor(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(12)
        .background(Color(red: 0.06, green: 0.09, blue: 0.16))
    }
}

// MARK: - Medium Widget View (4x2)

struct MediumWidgetView: View {
    var entry: TaskTimelineProvider.Entry

    var body: some View {
        let today = entry.snapshot?.today
        let tasks = today?.tasks ?? []
        let total = today?.total ?? 0
        let completed = today?.completed ?? 0
        let percent = today?.percent ?? 0
        let remainingCount = max(0, total - 3)

        VStack(alignment: .leading, spacing: 6) {
            HStack {
                HStack(spacing: 4) {
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(Color(red: 0.22, green: 0.74, blue: 0.97))
                    Text("StockFlow Tasks")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(Color(red: 0.22, green: 0.74, blue: 0.97))
                }
                Spacer()
                if entry.isStale {
                    Text("⚠️ Tap to sync")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.orange)
                } else if total > 0 {
                    Text("\(completed)/\(total) Done (\(percent)%)")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(Color(white: 0.9))
                } else {
                    Text("Today")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                }
            }

            if total > 0 {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Color(white: 0.2))
                            .frame(height: 5)
                        RoundedRectangle(cornerRadius: 3)
                            .fill(percent == 100 ? Color.green : Color(red: 0.22, green: 0.74, blue: 0.97))
                            .frame(width: max(5, geo.size.width * CGFloat(percent) / 100.0), height: 5)
                    }
                }
                .frame(height: 5)
            }

            if total == 0 {
                Spacer()
                HStack {
                    Spacer()
                    VStack(spacing: 3) {
                        Image(systemName: entry.snapshot == nil ? "arrow.triangle.2.circlepath" : "checklist")
                            .font(.system(size: 18))
                            .foregroundColor(.secondary)
                        Text(entry.snapshot == nil ? "Open StockFlow to sync tasks" : "No tasks scheduled for today")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(Color(white: 0.8))
                        Text(entry.snapshot == nil ? "Tap to load your schedule" : "All caught up • Tap to open app")
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
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
                                .foregroundColor(task.isCompleted ? .green : Color(red: 0.22, green: 0.74, blue: 0.97))

                            Text(task.title)
                                .font(.system(size: 11, weight: .medium))
                                .lineLimit(1)
                                .foregroundColor(task.isCompleted ? .secondary : Color(white: 0.95))

                            Spacer()

                            if !task.timeFormatted.isEmpty && task.timeFormatted != "--:--" {
                                Text(task.timeFormatted)
                                    .font(.system(size: 10, weight: .regular))
                                    .foregroundColor(.secondary)
                            }
                        }
                    }

                    if remainingCount > 0 {
                        Text("+ \(remainingCount) more task\(remainingCount == 1 ? "" : "s") today")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(.secondary)
                            .padding(.top, 1)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(12)
        .background(Color(red: 0.06, green: 0.09, blue: 0.16))
    }
}

// MARK: - SwiftUI Views for Upcoming Tasks Widget

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

struct UpcomingSmallWidgetView: View {
    var entry: TaskTimelineProvider.Entry

    var body: some View {
        let upcoming = entry.snapshot?.upcoming7Days ?? entry.snapshot?.tomorrow
        let tasks = upcoming?.tasks ?? []
        let total = upcoming?.total ?? tasks.count

        VStack(alignment: .leading, spacing: 6) {
            HStack {
                HStack(spacing: 4) {
                    Image(systemName: "calendar.badge.clock")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(Color(red: 0.22, green: 0.74, blue: 0.97))
                    Text("Upcoming")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(Color(red: 0.22, green: 0.74, blue: 0.97))
                }
                Spacer()
                if total > 0 {
                    Text("\(total)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.secondary)
                }
            }

            if total == 0 {
                Spacer()
                VStack(alignment: .leading, spacing: 2) {
                    Text("Clear Horizon")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.primary)
                    Text("No upcoming tasks")
                        .font(.system(size: 9))
                        .foregroundColor(.secondary)
                }
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(tasks.prefix(2)) { task in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(task.title)
                                .font(.system(size: 10, weight: .medium))
                                .lineLimit(1)
                                .foregroundColor(.primary)
                            HStack(spacing: 4) {
                                if let dateLabel = task.dateFormatted, !dateLabel.isEmpty {
                                    Text(dateLabel)
                                        .font(.system(size: 8, weight: .semibold))
                                        .foregroundColor(Color(red: 0.22, green: 0.74, blue: 0.97))
                                }
                                if !task.timeFormatted.isEmpty && task.timeFormatted != "--:--" {
                                    Text(task.timeFormatted)
                                        .font(.system(size: 8))
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    }
                    if total > 2 {
                        Text("+ \(total - 2) more")
                            .font(.system(size: 8, weight: .medium))
                            .foregroundColor(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(12)
        .background(Color(red: 0.06, green: 0.09, blue: 0.16))
    }
}

struct UpcomingMediumWidgetView: View {
    var entry: TaskTimelineProvider.Entry

    var body: some View {
        let upcoming = entry.snapshot?.upcoming7Days ?? entry.snapshot?.tomorrow
        let tasks = upcoming?.tasks ?? []
        let total = upcoming?.total ?? tasks.count
        let remainingCount = max(0, total - 3)

        VStack(alignment: .leading, spacing: 6) {
            HStack {
                HStack(spacing: 4) {
                    Image(systemName: "calendar.badge.clock")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(Color(red: 0.22, green: 0.74, blue: 0.97))
                    Text("StockFlow Upcoming")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(Color(red: 0.22, green: 0.74, blue: 0.97))
                }
                Spacer()
                if total > 0 {
                    Text("\(total) Scheduled")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(Color(white: 0.9))
                } else {
                    Text("Next 7 Days")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                }
            }

            if total == 0 {
                Spacer()
                HStack {
                    Spacer()
                    VStack(spacing: 3) {
                        Image(systemName: "calendar")
                            .font(.system(size: 18))
                            .foregroundColor(.secondary)
                        Text("No upcoming tasks scheduled")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(Color(white: 0.8))
                        Text("Tasks scheduled for future days will appear here")
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                }
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(tasks.prefix(3)) { task in
                        HStack(spacing: 6) {
                            Circle()
                                .fill(task.priority == "high" ? Color.red : (task.priority == "low" ? Color.gray : Color(red: 0.22, green: 0.74, blue: 0.97)))
                                .frame(width: 6, height: 6)

                            Text(task.title)
                                .font(.system(size: 11, weight: .medium))
                                .lineLimit(1)
                                .foregroundColor(Color(white: 0.95))

                            Spacer()

                            if let dateLabel = task.dateFormatted, !dateLabel.isEmpty {
                                Text(dateLabel)
                                    .font(.system(size: 10, weight: .semibold))
                                    .foregroundColor(Color(red: 0.22, green: 0.74, blue: 0.97))
                            }

                            if !task.timeFormatted.isEmpty && task.timeFormatted != "--:--" {
                                Text(task.timeFormatted)
                                    .font(.system(size: 10, weight: .regular))
                                    .foregroundColor(.secondary)
                            }
                        }
                    }

                    if remainingCount > 0 {
                        Text("+ \(remainingCount) more upcoming task\(remainingCount == 1 ? "" : "s")")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(.secondary)
                            .padding(.top, 1)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(12)
        .background(Color(red: 0.06, green: 0.09, blue: 0.16))
    }
}

// MARK: - Widget Declarations

struct StockFlowTasksWidget: Widget {
    let kind: String = "StockFlowTasksWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TaskTimelineProvider()) { entry in
            StockFlowTasksWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("StockFlow Tasks")
        .description("View today's scheduled tasks and completion progress.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct StockFlowUpcomingWidget: Widget {
    let kind: String = "StockFlowUpcomingWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TaskTimelineProvider()) { entry in
            StockFlowUpcomingWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("StockFlow Upcoming Tasks")
        .description("Upcoming 7-day scheduled tasks.")
        .supportedFamilies([.systemSmall, .systemMedium])
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
