import { isRunningInExpoGo } from 'expo';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import type * as NotificationsType from 'expo-notifications';

export const TASK_REMINDER_CHANNEL_ID = 'task-reminders';

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
 * Configure foreground notification behavior and Android notification channel.
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
    } catch (error) {
      console.warn('Failed to configure Android notification channel:', error);
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
export async function cancelTaskReminderAsync(taskId: number): Promise<boolean> {
  const Notifications = getNotifications();
  if (!Notifications) return false;

  try {
    const scheduledList = await Notifications.getAllScheduledNotificationsAsync();
    let cancelled = false;

    for (const item of scheduledList) {
      if (item.content.data?.taskId === taskId) {
        await Notifications.cancelScheduledNotificationAsync(item.identifier);
        cancelled = true;
      }
    }

    return cancelled;
  } catch (error) {
    console.error(`Error cancelling reminder for task ${taskId}:`, error);
    return false;
  }
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
