import 'dart:convert';
import 'package:stockflow_mobile/core/config/api_config.dart';
import 'package:stockflow_mobile/core/network/api_client.dart';
import 'package:stockflow_mobile/core/network/network_info.dart';
import 'package:stockflow_mobile/core/notifications/notification_service.dart';
import 'package:stockflow_mobile/core/storage/local_database.dart';
import 'package:stockflow_mobile/core/widgets/widget_sync_service.dart';
import 'package:stockflow_mobile/features/tasks/models/daily_progress.dart';
import 'package:stockflow_mobile/features/tasks/models/task.dart';
import 'task_sync_engine.dart';

class TaskRepository {
  final ApiClient _apiClient;
  final LocalDatabase _localDb;
  final NetworkInfo _networkInfo;
  final NotificationService _notifications;
  final TaskSyncEngine _syncEngine;

  TaskSyncEngine get syncEngine => _syncEngine;

  TaskRepository({
    ApiClient? apiClient,
    LocalDatabase? localDb,
    NetworkInfo? networkInfo,
    NotificationService? notifications,
    TaskSyncEngine? syncEngine,
  })  : _apiClient = apiClient ?? ApiClient(),
        _localDb = localDb ?? LocalDatabase.instance,
        _networkInfo = networkInfo ?? NetworkInfo(),
        _notifications = notifications ?? NotificationService(),
        _syncEngine = syncEngine ??
            TaskSyncEngine(
              apiClient: apiClient,
              localDb: localDb,
              networkInfo: networkInfo,
            );

  Future<int> syncQueueNow() => _syncEngine.processPendingSyncQueue();

  Future<List<Task>> getLocalTasks() => _localDb.getAllTasks();

  Future<int> getPendingSyncCount() => _localDb.getPendingSyncCount('task');

  Future<List<Task>> getTasks({bool forceRefresh = false}) async {
    // 1. Immediately return local cached tasks for instant UI rendering
    final localTasks = await _localDb.getAllTasks();

    final isOnline = await _networkInfo.isConnected;
    if (!isOnline && localTasks.isNotEmpty) {
      await WidgetSyncService.syncWidgetSnapshot(localTasks);
      return localTasks;
    }

    // 2. Fetch fresh tasks from remote API if online
    if (isOnline) {
      try {
        final response = await _apiClient.get(ApiConfig.tasksUrl);
        if (response is List) {
          final remoteTasks = response
              .map((item) => Task.fromJson(item as Map<String, dynamic>))
              .toList();

          await _localDb.replaceAllTasks(remoteTasks);
          final updated = await _localDb.getAllTasks();
          await WidgetSyncService.syncWidgetSnapshot(updated);
          return updated;
        }
      } catch (e) {
        if (localTasks.isNotEmpty) {
          await WidgetSyncService.syncWidgetSnapshot(localTasks);
          return localTasks;
        }
        rethrow;
      }
    }

    await WidgetSyncService.syncWidgetSnapshot(localTasks);
    return localTasks;
  }

  Future<Task> createTask(Task task) async {
    final isOnline = await _networkInfo.isConnected;

    if (isOnline) {
      try {
        final response = await _apiClient.post(
          ApiConfig.tasksUrl,
          body: task.toJson(),
        );
        final created = Task.fromJson(response as Map<String, dynamic>);
        await _localDb.insertTask(created.copyWith(isSynced: true));

        // Schedule local reminder if applicable
        if (created.localScheduledDateTime != null) {
          await _notifications.scheduleTaskReminder(
            taskId: created.id,
            title: created.title,
            body: created.description.isNotEmpty
                ? created.description
                : 'Task is scheduled for today.',
            scheduledDate: created.localScheduledDateTime!,
            offsetMinutes: created.reminderMinutes ?? 0,
          );
        }

        final allTasks = await _localDb.getAllTasks();
        await WidgetSyncService.syncWidgetSnapshot(allTasks);
        return created;
      } catch (_) {
        // Fallback to offline creation
      }
    }

    // Offline creation: generate temporary negative local ID
    final tempId = -DateTime.now().millisecondsSinceEpoch;
    final offlineTask = task.copyWith(
      id: tempId,
      isSynced: false,
      createdAt: DateTime.now().toIso8601String(),
      updatedAt: DateTime.now().toIso8601String(),
    );

    await _localDb.insertTask(offlineTask);

    await _localDb.enqueueSync(
      action: 'create',
      entityType: 'task',
      entityId: tempId,
      payloadJson: jsonEncode(task.toJson()),
    );

    if (offlineTask.localScheduledDateTime != null) {
      await _notifications.scheduleTaskReminder(
        taskId: tempId,
        title: offlineTask.title,
        body: offlineTask.description.isNotEmpty
            ? offlineTask.description
            : 'Scheduled task reminder',
        scheduledDate: offlineTask.localScheduledDateTime!,
        offsetMinutes: offlineTask.reminderMinutes ?? 0,
      );
    }

    final allTasks = await _localDb.getAllTasks();
    await WidgetSyncService.syncWidgetSnapshot(allTasks);

    return offlineTask;
  }

  Future<Task> updateTask(Task task) async {
    final isOnline = await _networkInfo.isConnected;

    if (isOnline && task.id > 0) {
      try {
        final response = await _apiClient.put(
          ApiConfig.taskDetailUrl(task.id),
          body: task.toJson(),
        );
        final updated = Task.fromJson(response as Map<String, dynamic>);
        await _localDb.updateTask(updated.copyWith(isSynced: true));

        if (updated.isDone) {
          await _notifications.cancelTaskReminder(updated.id);
        } else if (updated.localScheduledDateTime != null) {
          await _notifications.scheduleTaskReminder(
            taskId: updated.id,
            title: updated.title,
            body: updated.description.isNotEmpty
                ? updated.description
                : 'Scheduled task reminder',
            scheduledDate: updated.localScheduledDateTime!,
            offsetMinutes: updated.reminderMinutes ?? 0,
          );
        }

        final allTasks = await _localDb.getAllTasks();
        await WidgetSyncService.syncWidgetSnapshot(allTasks);
        return updated;
      } catch (_) {
        // Fallback to offline update
      }
    }

    // Offline update
    final offlineTask = task.copyWith(
      isSynced: false,
      updatedAt: DateTime.now().toIso8601String(),
    );
    await _localDb.updateTask(offlineTask);

    await _localDb.enqueueSync(
      action: 'update',
      entityType: 'task',
      entityId: task.id,
      payloadJson: jsonEncode(task.toJson()),
    );

    if (offlineTask.isDone) {
      await _notifications.cancelTaskReminder(offlineTask.id);
    } else if (offlineTask.localScheduledDateTime != null) {
      await _notifications.scheduleTaskReminder(
        taskId: offlineTask.id,
        title: offlineTask.title,
        body: offlineTask.description.isNotEmpty
            ? offlineTask.description
            : 'Scheduled task reminder',
        scheduledDate: offlineTask.localScheduledDateTime!,
        offsetMinutes: offlineTask.reminderMinutes ?? 0,
      );
    }

    final allTasks = await _localDb.getAllTasks();
    await WidgetSyncService.syncWidgetSnapshot(allTasks);

    return offlineTask;
  }

  Future<Task> toggleTaskCompletion(int id, [bool? completed]) async {
    final existing = await _localDb.getTaskById(id);
    if (existing == null) {
      throw Exception('Task with id $id not found.');
    }

    final nextCompleted = completed ?? !existing.isDone;
    final nextStatus = nextCompleted ? TaskStatus.completed : TaskStatus.pending;
    final toggled = existing.copyWith(
      isCompleted: nextCompleted,
      status: nextStatus,
      updatedAt: DateTime.now().toIso8601String(),
    );

    return await updateTask(toggled);
  }

  Future<void> deleteTask(int id) async {
    final isOnline = await _networkInfo.isConnected;

    await _localDb.deleteTask(id);
    await _notifications.cancelTaskReminder(id);

    if (isOnline && id > 0) {
      try {
        await _apiClient.delete(ApiConfig.taskDetailUrl(id));
      } catch (_) {
        await _localDb.enqueueSync(
          action: 'delete',
          entityType: 'task',
          entityId: id,
          payloadJson: jsonEncode({'id': id}),
        );
      }
    } else if (id > 0) {
      await _localDb.enqueueSync(
        action: 'delete',
        entityType: 'task',
        entityId: id,
        payloadJson: jsonEncode({'id': id}),
      );
    }

    final allTasks = await _localDb.getAllTasks();
    await WidgetSyncService.syncWidgetSnapshot(allTasks);
  }

  // ==========================================
  // DAILY PROGRESS
  // ==========================================

  Future<DailyProgress?> getDailyProgress(String date) async {
    final local = await _localDb.getDailyProgress(date);
    final isOnline = await _networkInfo.isConnected;

    if (isOnline) {
      try {
        final response = await _apiClient.get(ApiConfig.dailyProgressByDateUrl(date));
        if (response is Map<String, dynamic>) {
          final remote = DailyProgress.fromJson(response);
          await _localDb.saveDailyProgress(remote.copyWith(isSynced: true));
          return remote;
        }
      } catch (_) {}
    }

    return local;
  }

  Future<DailyProgress> saveDailyProgress(
    dynamic progressOrDate, {
    String? journalNotes,
  }) async {
    DailyProgress progress;
    if (progressOrDate is DailyProgress) {
      progress = progressOrDate;
    } else if (progressOrDate is String) {
      final existing = await getDailyProgress(progressOrDate);
      progress = (existing ?? DailyProgress(date: progressOrDate)).copyWith(
        notes: journalNotes ?? '',
        description: journalNotes ?? '',
        updatedAt: DateTime.now().toIso8601String(),
      );
    } else {
      throw ArgumentError('Invalid argument for saveDailyProgress');
    }

    final isOnline = await _networkInfo.isConnected;

    if (isOnline) {
      try {
        final response = await _apiClient.post(
          ApiConfig.dailyProgressUrl,
          body: progress.toJson(),
        );
        final saved = DailyProgress.fromJson(response as Map<String, dynamic>);
        await _localDb.saveDailyProgress(saved.copyWith(isSynced: true));
        return saved;
      } catch (_) {}
    }

    final offline = progress.copyWith(isSynced: false);
    await _localDb.saveDailyProgress(offline);

    await _localDb.enqueueSync(
      action: 'create',
      entityType: 'daily_progress',
      dateKey: progress.date,
      payloadJson: jsonEncode(progress.toJson()),
    );

    return offline;
  }
}
