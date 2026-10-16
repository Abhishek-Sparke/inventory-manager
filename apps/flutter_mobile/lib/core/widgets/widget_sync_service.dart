import 'dart:convert';
import 'package:home_widget/home_widget.dart';
import '../../features/tasks/models/task.dart';

class WidgetSyncService {
  static const String widgetSnapshotKey = 'stockflow_widget_snapshot_v1';
  static const String androidWidgetName = 'StockFlowTasksWidget';
  static const String upcomingWidgetName = 'StockFlowUpcomingWidget';

  static Future<void> syncWidgetSnapshot(List<Task> tasks) async {
    try {
      final now = DateTime.now();
      final todayStr = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
      final tomorrowDate = now.add(const Duration(days: 1));
      final tomorrowStr = '${tomorrowDate.year}-${tomorrowDate.month.toString().padLeft(2, '0')}-${tomorrowDate.day.toString().padLeft(2, '0')}';

      final todayTasks = <Map<String, dynamic>>[];
      final tomorrowTasks = <Map<String, dynamic>>[];
      final upcomingTasks = <Map<String, dynamic>>[];

      int completedCount = 0;
      int todayCompletedCount = 0;

      for (final t in tasks) {
        if (t.isDone) completedCount++;

        final dateStr = t.localDateString;
        final item = {
          'id': t.id,
          'title': t.title,
          'timeFormatted': _formatTime(t.localScheduledDateTime),
          'priority': t.priority.value,
          'isCompleted': t.isDone,
        };

        if (dateStr == todayStr) {
          todayTasks.add(item);
          if (t.isDone) todayCompletedCount++;
        } else if (dateStr == tomorrowStr) {
          tomorrowTasks.add(item);
        } else if (t.isUpcoming(now)) {
          upcomingTasks.add(item);
        }
      }

      final overallPercent = tasks.isEmpty
          ? 0
          : ((completedCount / tasks.length) * 100).round();
      final todayPercent = todayTasks.isEmpty
          ? 0
          : ((todayCompletedCount / todayTasks.length) * 100).round();

      final payload = {
        'updatedAt': now.toIso8601String(),
        'overallPercent': overallPercent,
        'today': {
          'total': todayTasks.length,
          'completed': todayCompletedCount,
          'percent': todayPercent,
          'tasks': todayTasks,
        },
        'tomorrow': {
          'total': tomorrowTasks.length,
          'tasks': tomorrowTasks,
        },
        'upcoming7Days': {
          'total': upcomingTasks.length,
          'tasks': upcomingTasks,
        },
      };

      final jsonStr = jsonEncode(payload);

      await HomeWidget.saveWidgetData<String>(widgetSnapshotKey, jsonStr);
      await HomeWidget.saveWidgetData<int>('today_total', todayTasks.length);
      await HomeWidget.saveWidgetData<int>('today_completed', todayCompletedCount);
      await HomeWidget.saveWidgetData<int>('today_percent', todayPercent);

      await HomeWidget.updateWidget(name: androidWidgetName);
      await HomeWidget.updateWidget(name: upcomingWidgetName);
    } catch (_) {
      // Non-fatal if platform widgets are not enabled or supported
    }
  }

  static String _formatTime(DateTime? dt) {
    if (dt == null) return '--:--';
    final h = dt.hour.toString().padLeft(2, '0');
    final m = dt.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }
}
