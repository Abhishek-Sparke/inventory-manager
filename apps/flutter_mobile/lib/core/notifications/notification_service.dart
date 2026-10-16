import 'dart:io';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import '../storage/local_database.dart';

class NotificationService {
  static const String taskChannelId = 'task-reminders';
  static const String taskChannelName = 'Task Reminders';
  static const String taskChannelDesc = 'Scheduled reminders for StockFlow inventory tasks';

  static const String alertChannelId = 'inventory-alerts';
  static const String alertChannelName = 'Inventory Alerts';
  static const String alertChannelDesc = 'Low-stock and restock alerts for StockFlow inventory';

  final FlutterLocalNotificationsPlugin _notificationsPlugin =
      FlutterLocalNotificationsPlugin();
  final LocalDatabase _db = LocalDatabase.instance;
  bool _isInitialized = false;

  static final NotificationService _instance = NotificationService._internal();
  static NotificationService get instance => _instance;
  factory NotificationService() => _instance;
  NotificationService._internal();

  Future<void> initialize() => init();

  Future<void> init() async {
    if (_isInitialized) return;

    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const darwinSettings = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    );

    const initSettings = InitializationSettings(
      android: androidSettings,
      iOS: darwinSettings,
      macOS: darwinSettings,
    );

    await _notificationsPlugin.initialize(initSettings);

    if (Platform.isAndroid) {
      final androidPlugin = _notificationsPlugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>();

      if (androidPlugin != null) {
        await androidPlugin.createNotificationChannel(
          const AndroidNotificationChannel(
            taskChannelId,
            taskChannelName,
            description: taskChannelDesc,
            importance: Importance.high,
            playSound: true,
            enableVibration: true,
          ),
        );

        await androidPlugin.createNotificationChannel(
          const AndroidNotificationChannel(
            alertChannelId,
            alertChannelName,
            description: alertChannelDesc,
            importance: Importance.high,
            playSound: true,
            enableVibration: true,
          ),
        );
      }
    }

    _isInitialized = true;
  }

  Future<bool> requestPermissions() async {
    if (Platform.isAndroid) {
      final androidPlugin = _notificationsPlugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>();
      if (androidPlugin != null) {
        final granted = await androidPlugin.requestNotificationsPermission();
        return granted ?? false;
      }
    } else if (Platform.isIOS) {
      final iosPlugin = _notificationsPlugin
          .resolvePlatformSpecificImplementation<
              IOSFlutterLocalNotificationsPlugin>();
      if (iosPlugin != null) {
        final granted = await iosPlugin.requestPermissions(
          alert: true,
          badge: true,
          sound: true,
        );
        return granted ?? false;
      }
    }
    return true;
  }

  Future<void> scheduleTaskReminder({
    required int taskId,
    required String title,
    required String body,
    required DateTime scheduledDate,
    int offsetMinutes = 0,
  }) async {
    await init();
    // Cancel existing reminder first to prevent stale duplicates
    await cancelTaskReminder(taskId);

    final triggerTime = scheduledDate.subtract(Duration(minutes: offsetMinutes));
    if (triggerTime.isBefore(DateTime.now())) {
      // Trigger time has already passed; do not schedule stale past notification
      return;
    }

    // In local notifications, ID must be within 32-bit int range
    final notificationId = taskId.abs() % 2147483647;

    const androidDetails = AndroidNotificationDetails(
      taskChannelId,
      taskChannelName,
      channelDescription: taskChannelDesc,
      importance: Importance.high,
      priority: Priority.high,
      icon: '@mipmap/ic_launcher',
    );
    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );
    const details = NotificationDetails(android: androidDetails, iOS: iosDetails);

    try {
      if (triggerTime.isBefore(DateTime.now().add(const Duration(minutes: 5)))) {
        await _notificationsPlugin.show(notificationId, title, body, details);
      }
      await _db.saveTaskReminder(
        taskId: taskId,
        notificationId: notificationId.toString(),
        triggerTime: triggerTime.toIso8601String(),
        offsetMinutes: offsetMinutes,
      );
    } catch (_) {}
  }

  Future<void> cancelTaskReminder(int taskId) async {
    await init();
    final notificationId = taskId.abs() % 2147483647;
    await _notificationsPlugin.cancel(notificationId);
    try {
      await _db.deleteTaskReminder(taskId);
    } catch (_) {}
  }

  Future<void> showInventoryAlert({
    required String title,
    required String body,
    int id = 99999,
  }) async {
    await init();
    const androidDetails = AndroidNotificationDetails(
      alertChannelId,
      alertChannelName,
      channelDescription: alertChannelDesc,
      importance: Importance.high,
      priority: Priority.high,
      icon: '@mipmap/ic_launcher',
    );
    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );
    const details = NotificationDetails(android: androidDetails, iOS: iosDetails);

    await _notificationsPlugin.show(id, title, body, details);
  }
}
