import 'package:flutter_test/flutter_test.dart';
import 'package:stockflow_mobile/features/tasks/models/task.dart';

void main() {
  group('Task Filtering & Sorting Tests', () {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day, 12, 0);

    final tHighOverdue = Task(
      id: 1,
      title: 'High Overdue',
      priority: TaskPriority.high,
      scheduledAt: today.subtract(const Duration(days: 1)).toIso8601String(),
      isCompleted: false,
    );

    final tMediumToday = Task(
      id: 2,
      title: 'Medium Today',
      priority: TaskPriority.medium,
      scheduledAt: today.toIso8601String(),
      isCompleted: false,
    );

    final tLowToday = Task(
      id: 3,
      title: 'Low Today',
      priority: TaskPriority.low,
      scheduledAt: today.toIso8601String(),
      isCompleted: false,
    );

    final tUpcoming = Task(
      id: 4,
      title: 'Upcoming',
      priority: TaskPriority.high,
      scheduledAt: today.add(const Duration(days: 3)).toIso8601String(),
      isCompleted: false,
    );

    final tCompleted = Task(
      id: 5,
      title: 'Completed Task',
      priority: TaskPriority.high,
      scheduledAt: today.toIso8601String(),
      isCompleted: true,
      status: TaskStatus.completed,
    );

    final allTasks = [tLowToday, tCompleted, tUpcoming, tHighOverdue, tMediumToday];

    test('Today filter matches today tasks and overdue incomplete tasks', () {
      final todayList = allTasks.where((t) => t.isToday() || (t.isOverdue && !t.isDone)).toList();
      expect(todayList.contains(tHighOverdue), true);
      expect(todayList.contains(tMediumToday), true);
      expect(todayList.contains(tLowToday), true);
      expect(todayList.contains(tUpcoming), false);
    });

    test('Upcoming filter matches future incomplete tasks', () {
      final upcomingList = allTasks.where((t) => t.isUpcoming() && !t.isDone).toList();
      expect(upcomingList.length, 1);
      expect(upcomingList.first.id, tUpcoming.id);
    });

    test('Completed filter matches completed tasks', () {
      final completedList = allTasks.where((t) => t.isDone).toList();
      expect(completedList.length, 1);
      expect(completedList.first.id, tCompleted.id);
    });

    test('Priority sorting places incomplete higher-rank tasks first', () {
      final list = List<Task>.from(allTasks);
      list.sort((a, b) {
        if (a.isDone != b.isDone) return a.isDone ? 1 : -1;
        final pA = a.priority.rank;
        final pB = b.priority.rank;
        if (pA != pB) return pA.compareTo(pB);
        final sA = a.scheduledAt ?? '';
        final sB = b.scheduledAt ?? '';
        return sA.compareTo(sB);
      });

      // tCompleted must be at the very bottom
      expect(list.last.id, tCompleted.id);

      // tHighOverdue (rank 1) should come before tMediumToday (rank 2)
      expect(list[0].priority.rank <= list[1].priority.rank, true);
    });
  });
}
