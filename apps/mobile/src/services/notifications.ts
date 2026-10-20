import { isRunningInExpoGo } from 'expo';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import type * as NotificationsType from 'expo-notifications';

export const TASK_REMINDER_CHANNEL_ID = 'task-reminders';
export const INVENTORY_ALERTS_CHANNEL_ID = 'inventory-alerts';

let isHandlerConfigured = false;

/**
 * Detects whether the app is executing inside the standard Expo Go client app.
 */
export function isExpoGoClient(): boolean {
  return (
    isRunningInExpoGo() ||
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
    (Constants as Record<string, unknown>).appOwnership === 'expo'
  );
}

/**
 * Lazily loads the native expo-notifications module only in compatible native environments.
 * In Expo Go on SDK 53+ or on Web, returns null to prevent startup crashes.
 */
function getNotifications(): typeof NotificationsType | null {
  if (Platform.OS === 'web' || isExpoGoClient()) {
    return null;
  }

  try {
    // Dynamic require so Metro doesn't execute expo-notifications top-level side effects in Expo Go
    return require('expo-notifications');
  } catch (error) {
    console.warn('[Notifications] Could not load expo-notifications native module:', error);
    return null;
  }
}

/**
 * Configure foreground notification behavior and Android notification channels.
 */
export async function setupNotificationEnvironmentAsync(): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;

  if (!isHandlerConfigured) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    isHandlerConfigured = true;
  }

  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync(TASK_REMINDER_CHANNEL_ID, {
        name: 'Task Reminders',
        description: 'Scheduled reminders for StockFlow inventory tasks',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#4263EB',
        sound: 'default',
        enableVibrate: true,
        enableLights: true,
        showBadge: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });

      await Notifications.setNotificationChannelAsync(INVENTORY_ALERTS_CHANNEL_ID, {
        name: 'Inventory Alerts',
        description: 'Low-stock and restock alerts for StockFlow inventory',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 300, 200, 300],
        lightColor: '#DC2626',
        sound: 'default',
        enableVibrate: true,
        enableLights: true,
        showBadge: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    } catch (error) {
      console.warn('Failed to configure Android notification channels:', error);
    }
  }
}

/**
 * Check and request notification permissions on the device.
 */
export async function requestNotificationPermissionAsync(): Promise<boolean> {
  const Notifications = getNotifications();
  if (!Notifications) return false;

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    if (existingStatus === 'granted') {
      return true;
    }

    const { status: newStatus } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    return newStatus === 'granted';
  } catch (error) {
    console.error('Error requesting notification permissions:', error);
    return false;
  }
}

/**
 * Dispatches an immediate local OS notification with optional sound, vibration, and data.
 */
export async function sendImmediateNotificationAsync(params: {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channelId?: string;
}): Promise<boolean> {
  const Notifications = getNotifications();
  if (!Notifications) return false;

  await setupNotificationEnvironmentAsync();

  const hasPermission = await requestNotificationPermissionAsync();
  if (!hasPermission) return false;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: params.title,
        body: params.body,
        data: params.data,
        sound: true,
      },
      trigger: Platform.OS === 'android'
        ? {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(Date.now() + 100),
            channelId: params.channelId || INVENTORY_ALERTS_CHANNEL_ID,
          }
        : null,
    });
    return true;
  } catch (error) {
    console.error('Failed to dispatch immediate notification:', error);
    return false;
  }
}

export type ScheduleResult =
  | { success: true; identifier: string; triggerDate: Date }
  | {
      success: false;
      reason:
        | 'past'
        | 'completed'
        | 'no_date'
        | 'permission_denied'
        | 'platform_unsupported'
        | 'error';
      message?: string;
    };

/**
 * Schedule a local notification for a task.
 * Automatically cancels any prior notification for this task to avoid duplicates.
 */
export async function scheduleTaskReminderAsync(
  task: {
    id: number;
    title: string;
    description?: string;
    scheduled_at: string | null;
    priority?: string;
    is_completed?: boolean;
  },
  offsetMinutes = 0
): Promise<ScheduleResult> {
  const Notifications = getNotifications();
  if (!Notifications) {
    return {
      success: false,
      reason: 'platform_unsupported',
      message: isExpoGoClient()
        ? 'Native reminders require an EAS development build or standalone APK (unavailable in Expo Go).'
        : 'Notification module unavailable on this platform.',
    };
  }

  if (task.is_completed) {
    await cancelTaskReminderAsync(task.id);
    return { success: false, reason: 'completed' };
  }

  if (!task.scheduled_at) {
    return { success: false, reason: 'no_date' };
  }

  const baseDate = new Date(task.scheduled_at);
  if (isNaN(baseDate.getTime())) {
    return { success: false, reason: 'no_date', message: 'Invalid scheduled date' };
  }

  const triggerTimeMs = baseDate.getTime() - offsetMinutes * 60 * 1000;
  const nowMs = Date.now();

  // Guard: do not schedule in the past
  if (triggerTimeMs <= nowMs) {
    await cancelTaskReminderAsync(task.id);
    return { success: false, reason: 'past' };
  }

  // Ensure notification channel and handler are ready
  await setupNotificationEnvironmentAsync();

  // Check / request permissions
  const hasPermission = await requestNotificationPermissionAsync();
  if (!hasPermission) {
    return {
      success: false,
      reason: 'permission_denied',
      message: 'Notification permissions were not granted by the device.',
    };
  }

  // Cancel prior reminder for this task if one already exists
  await cancelTaskReminderAsync(task.id);

  try {
    const triggerDate = new Date(triggerTimeMs);

    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: `📋 Task Due: ${task.title}`,
        body: task.description
          ? task.description
          : `Priority: ${(task.priority || 'medium').toUpperCase()} · Due now in StockFlow`,
        data: {
          taskId: task.id,
          scheduledAt: task.scheduled_at,
        },
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
        channelId: TASK_REMINDER_CHANNEL_ID,
      },
    });

    // Persist reminder identifier and trigger time to local SQLite database
    try {
      const { saveTaskReminderRecordAsync } = require('@/services/database');
      await saveTaskReminderRecordAsync({
        taskId: task.id,
        notificationId: identifier,
        triggerTime: triggerDate.toISOString(),
        offsetMinutes,
      });
    } catch (dbErr) {
      console.warn(`[Notifications] Failed to persist reminder record for task ${task.id} to SQLite:`, dbErr);
    }

    return {
      success: true,
      identifier,
      triggerDate,
    };
  } catch (error) {
    console.error(`Failed to schedule reminder for task ${task.id}:`, error);
    return {
      success: false,
      reason: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Cancel any scheduled local notification matching the given taskId.
 */
/**
 * Cancel any scheduled local notification matching the given taskId.
 */
export async function cancelTaskReminderAsync(taskId: number): Promise<boolean> {
  const Notifications = getNotifications();
  let cancelled = false;

  // 1. Delete and fetch saved notification id from SQLite
  try {
    const { getTaskReminderRecordAsync, deleteTaskReminderRecordAsync } = require('@/services/database');
    const savedRecord = await getTaskReminderRecordAsync(taskId);
    if (savedRecord?.notification_id && Notifications) {
      await Notifications.cancelScheduledNotificationAsync(savedRecord.notification_id);
      cancelled = true;
    }
    await deleteTaskReminderRecordAsync(taskId);
  } catch (dbErr) {
    console.warn(`[Notifications] SQLite reminder lookup error for task ${taskId}:`, dbErr);
  }

  // 2. Also scan OS active reminders to ensure no orphaned alarms exist
  if (Notifications) {
    try {
      const scheduledList = await Notifications.getAllScheduledNotificationsAsync();
      for (const item of scheduledList) {
        if (item.content.data?.taskId === taskId) {
          await Notifications.cancelScheduledNotificationAsync(item.identifier);
          cancelled = true;
        }
      }
    } catch (error) {
      console.error(`Error cancelling reminder for task ${taskId}:`, error);
    }
  }

  return cancelled;
}

/**
 * Returns a Set of task IDs that currently have an active scheduled notification on this device.
 */
export async function getActiveReminderTaskIdsAsync(): Promise<Set<number>> {
  const Notifications = getNotifications();
  if (!Notifications) return new Set();

  try {
    const scheduledList = await Notifications.getAllScheduledNotificationsAsync();
    const result = new Set<number>();

    for (const item of scheduledList) {
      const taskId = item.content.data?.taskId;
      if (typeof taskId === 'number') {
        result.add(taskId);
      }
    }

    return result;
  } catch (error) {
    console.warn('Failed to retrieve active reminder task IDs:', error);
    return new Set();
  }
}

/**
 * Rebuild local notifications for all pending future tasks that have reminders enabled.
 * Call on app startup to restore alarms after device reboot or app restart.
 */
export async function rescheduleAllPendingTaskRemindersAsync(
  tasks: Array<{
    id: number;
    title: string;
    description?: string;
    scheduled_at: string | null;
    priority?: string;
    is_completed?: boolean;
    reminder_minutes?: number | null;
  }>
): Promise<number> {
  const Notifications = getNotifications();
  if (!Notifications) return 0;

  const nowMs = Date.now();
  let count = 0;

  for (const task of tasks) {
    if (task.is_completed || !task.scheduled_at) continue;

    const taskDate = new Date(task.scheduled_at);
    if (isNaN(taskDate.getTime())) continue;

    const offset = task.reminder_minutes ?? 0;
    const triggerMs = taskDate.getTime() - offset * 60 * 1000;

    if (triggerMs > nowMs) {
      const res = await scheduleTaskReminderAsync(task, offset);
      if (res.success) count++;
    }
  }

  return count;
}

/**
 * Reconciles scheduled local notifications with the SQLite database on app startup or reboot.
 * Cancels orphaned alarms and reschedules any pending future task reminders that are missing.
 */
export async function reconcileScheduledRemindersWithDatabaseAsync(): Promise<{ restored: number; cleaned: number }> {
  const Notifications = getNotifications();
  if (!Notifications) return { restored: 0, cleaned: 0 };

  let restored = 0;
  let cleaned = 0;

  try {
    const { getLocalTasksAsync, deleteTaskReminderRecordAsync } = require('@/services/database');
    const tasks = await getLocalTasksAsync();
    const taskMap = new Map<number, any>(tasks.map((t: any) => [t.id, t]));

    const scheduledList = await Notifications.getAllScheduledNotificationsAsync();
    const activeNotificationTaskIds = new Set(
      scheduledList.map((n: any) => n.content.data?.taskId).filter((id: any) => typeof id === 'number')
    );

    const nowMs = Date.now();

    // 1. Restore future pending tasks with reminders
    for (const task of tasks) {
      if (task.is_completed || !task.scheduled_at || task.reminder_minutes === null) continue;
      const taskTimeMs = new Date(task.scheduled_at).getTime();
      const offset = task.reminder_minutes ?? 0;
      const triggerTimeMs = taskTimeMs - offset * 60 * 1000;

      if (triggerTimeMs > nowMs && !activeNotificationTaskIds.has(task.id)) {
        const res = await scheduleTaskReminderAsync(task, offset);
        if (res.success) restored++;
      }
    }

    // 2. Clean up reminders for deleted or completed tasks
    for (const notif of scheduledList) {
      const taskId = notif.content.data?.taskId;
      if (typeof taskId === 'number') {
        const task = taskMap.get(taskId);
        if (!task || task.is_completed || task.reminder_minutes === null) {
          await Notifications.cancelScheduledNotificationAsync(notif.identifier);
          await deleteTaskReminderRecordAsync(taskId);
          cleaned++;
        }
      }
    }
  } catch (err) {
    console.warn('[Notifications] Error during startup reminder reconciliation:', err);
  }

  return { restored, cleaned };
}
