import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Task } from '@/app/tasks';
import { getLocalDateString, getTaskLocalDateString } from '@/utils/timezone';
import { getStoredInstallationCredentialsAsync } from './installation';

export const WIDGET_STORAGE_KEY = '@stockflow_widget_snapshot_v1';
export const WIDGET_NAME = 'StockFlowTasksWidget';
export const UPCOMING_WIDGET_NAME = 'StockFlowUpcomingWidget';

export function getWidgetStorageKey(installationId?: string | null): string {
  if (installationId && installationId.trim()) {
    return `@stockflow_widget_snapshot_${installationId.trim()}_v1`;
  }
  return WIDGET_STORAGE_KEY;
}

export interface WidgetTaskItem {
  id: number;
  title: string;
  timeFormatted: string; // e.g. "17:48"
  dateFormatted?: string; // e.g. "Tomorrow" or "Oct 16"
  priority: 'low' | 'medium' | 'high';
  isCompleted: boolean;
}

export interface StockFlowWidgetData {
  installationId?: string;
  updatedAt: string;
  overallPercent: number;
  today: {
    total: number;
    completed: number;
    percent: number;
    tasks: WidgetTaskItem[];
  };
  tomorrow: {
    total: number;
    tasks: WidgetTaskItem[];
  };
  upcoming7Days?: {
    total: number;
    tasks: WidgetTaskItem[];
  };
}

/**
 * Extracts formatted time (HH:mm) from a task's ISO scheduled_at string.
 */
export function getFormattedTime(isoString: string | null): string {
  if (!isoString) return '--:--';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '--:--';
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Prepares widget snapshot payload from real tasks.
 * Optional baseDate parameter allows deterministic calculation in tests and midnight rollover checks.
 */
export function prepareWidgetData(
  tasks: Task[],
  baseDate: Date = new Date()
): StockFlowWidgetData {
  const todayStr = getLocalDateString(baseDate);

  const tomorrow = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate() + 1
  );
  const tomorrowStr = getLocalDateString(tomorrow);

  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const todayList: WidgetTaskItem[] = [];
  const tomorrowList: WidgetTaskItem[] = [];
  const upcoming7DaysList: WidgetTaskItem[] = [];
  let completedCount = 0;

  const startOfTomorrow = tomorrow.getTime();
  const endOfSevenDays = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate() + 8,
    0,
    0,
    0,
    -1
  ).getTime();

  safeTasks.forEach(task => {
    const isDone = Boolean(task.is_completed || task.status === 'completed');
    if (isDone) {
      completedCount += 1;
    }

    if (!task.scheduled_at) {
      return;
    }

    const taskDateStr = getTaskLocalDateString(task.scheduled_at);
    if (!taskDateStr) return;

    const timeFormatted = getFormattedTime(task.scheduled_at);
    const taskTimeMs = new Date(task.scheduled_at).getTime();

    if (taskDateStr === todayStr) {
      todayList.push({
        id: task.id,
        title: task.title,
        timeFormatted,
        dateFormatted: 'Today',
        priority: task.priority || 'medium',
        isCompleted: isDone,
      });
    } else if (taskDateStr === tomorrowStr) {
      tomorrowList.push({
        id: task.id,
        title: task.title,
        timeFormatted,
        dateFormatted: 'Tomorrow',
        priority: task.priority || 'medium',
        isCompleted: isDone,
      });
    }

    // Tasks scheduled for the next 7 days (tomorrow through today + 7 days)
    if (taskTimeMs >= startOfTomorrow && taskTimeMs <= endOfSevenDays) {
      upcoming7DaysList.push({
        id: task.id,
        title: task.title,
        timeFormatted,
        dateFormatted: taskDateStr === tomorrowStr ? 'Tomorrow' : taskDateStr,
        priority: task.priority || 'medium',
        isCompleted: isDone,
      });
    }
  });

  // Sort today's tasks so upcoming/pending tasks appear first, ordered chronologically
  todayList.sort((a, b) => {
    if (a.isCompleted !== b.isCompleted) {
      return a.isCompleted ? 1 : -1;
    }
    return a.timeFormatted.localeCompare(b.timeFormatted);
  });

  // Sort upcoming tasks: pending first, then high priority, then chronological
  const priorityRank: Record<string, number> = { high: 1, medium: 2, low: 3 };
  upcoming7DaysList.sort((a, b) => {
    if (a.isCompleted !== b.isCompleted) {
      return a.isCompleted ? 1 : -1;
    }
    const rA = priorityRank[a.priority] ?? 2;
    const rB = priorityRank[b.priority] ?? 2;
    if (rA !== rB) return rA - rB;
    return (a.dateFormatted || '').localeCompare(b.dateFormatted || '') || a.timeFormatted.localeCompare(b.timeFormatted);
  });

  const total = safeTasks.length;
  const overallPercent = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  const todayCompleted = todayList.filter(t => t.isCompleted).length;
  const todayPercent =
    todayList.length > 0 ? Math.round((todayCompleted / todayList.length) * 100) : 0;

  return {
    updatedAt: baseDate.toISOString(),
    overallPercent,
    today: {
      total: todayList.length,
      completed: todayCompleted,
      percent: todayPercent,
      tasks: todayList,
    },
    tomorrow: {
      total: tomorrowList.length,
      tasks: tomorrowList,
    },
    upcoming7Days: {
      total: upcoming7DaysList.length,
      tasks: upcoming7DaysList,
    },
  };
}

/**
 * Saves the sanitized widget snapshot to local device storage.
 * Keyed both globally and isolated per installation workspace.
 */
export async function saveWidgetSnapshotAsync(
  data: StockFlowWidgetData,
  installationId?: string
): Promise<boolean> {
  try {
    let effectiveInstallationId = installationId;
    if (!effectiveInstallationId) {
      const creds = await getStoredInstallationCredentialsAsync().catch(() => null);
      if (creds?.installationId) {
        effectiveInstallationId = creds.installationId;
      }
    }

    const payload: StockFlowWidgetData = {
      ...data,
      ...(effectiveInstallationId ? { installationId: effectiveInstallationId } : {}),
    };

    const jsonString = JSON.stringify(payload);
    const writes = [AsyncStorage.setItem(WIDGET_STORAGE_KEY, jsonString)];
    if (effectiveInstallationId) {
      writes.push(AsyncStorage.setItem(getWidgetStorageKey(effectiveInstallationId), jsonString));
    }
    await Promise.all(writes);

    // Persist to native Android SharedPreferences and iOS UserDefaults via native bridge
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      try {
        const { StockFlowWidgetBridge } = NativeModules;
        if (StockFlowWidgetBridge?.setWidgetSnapshot) {
          await StockFlowWidgetBridge.setWidgetSnapshot(jsonString);
        }
      } catch (bridgeErr) {
        console.warn('[WidgetData] Native bridge save notice:', bridgeErr);
      }
    }

    return true;
  } catch (error) {
    console.warn('[WidgetData] Failed to serialize or save widget snapshot:', error);
    return false;
  }
}

/**
 * Loads the sanitized widget snapshot from local device storage for the active installation.
 * Handles corrupt JSON, schema mismatches, or snapshots belonging to another installation safely.
 */
export async function loadWidgetSnapshotAsync(
  installationId?: string
): Promise<StockFlowWidgetData | null> {
  try {
    let targetInstallationId = installationId;
    if (!targetInstallationId) {
      const creds = await getStoredInstallationCredentialsAsync().catch(() => null);
      if (creds?.installationId) {
        targetInstallationId = creds.installationId;
      }
    }

    let jsonString: string | null = null;
    if (targetInstallationId) {
      jsonString = await AsyncStorage.getItem(getWidgetStorageKey(targetInstallationId));
    }
    if (!jsonString) {
      jsonString = await AsyncStorage.getItem(WIDGET_STORAGE_KEY);
    }
    if (!jsonString) return null;

    const parsed = JSON.parse(jsonString) as StockFlowWidgetData;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.overallPercent !== 'number' ||
      !parsed.today ||
      typeof parsed.today.percent !== 'number' ||
      !Array.isArray(parsed.today.tasks)
    ) {
      console.warn('[WidgetData] Stored widget snapshot schema invalid, clearing.');
      return null;
    }

    // Isolate: If snapshot is tagged with an installation ID that doesn't match the current active installation, discard it
    if (
      targetInstallationId &&
      parsed.installationId &&
      parsed.installationId !== targetInstallationId
    ) {
      console.warn('[WidgetData] Stored snapshot belongs to another installation. Ignoring.');
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn('[WidgetData] Failed to load/parse widget snapshot:', error);
    return null;
  }
}

/**
 * Clears widget snapshot for the given installation or active installation.
 */
export async function clearWidgetSnapshotAsync(installationId?: string): Promise<void> {
  try {
    let targetInstallationId = installationId;
    if (!targetInstallationId) {
      const creds = await getStoredInstallationCredentialsAsync().catch(() => null);
      if (creds?.installationId) {
        targetInstallationId = creds.installationId;
      }
    }
    const removals = [AsyncStorage.removeItem(WIDGET_STORAGE_KEY)];
    if (targetInstallationId) {
      removals.push(AsyncStorage.removeItem(getWidgetStorageKey(targetInstallationId)));
    }
    await Promise.all(removals);
  } catch (error) {
    console.warn('[WidgetData] Failed to clear widget snapshot:', error);
  }
}

/**
 * Dispatches the latest task metrics to local storage and requests native Android widget redraw.
 * Safely executes even when tasks is empty so stale widget items are cleared.
 */
export async function syncWidgetDataAsync(
  tasks: Task[],
  baseDate?: Date,
  installationId?: string
): Promise<StockFlowWidgetData> {
  const widgetData = prepareWidgetData(tasks, baseDate);

  if (Platform.OS === 'web') {
    return widgetData;
  }

  // 1. Always persist snapshot locally so offline widget reads current state
  try {
    await saveWidgetSnapshotAsync(widgetData, installationId);
  } catch (saveError) {
    console.warn('[WidgetSync] Failed to persist snapshot:', saveError);
  }

  // 2. On Android and iOS, refresh native home-screen widgets via native bridge
  if (Platform.OS === 'android' || Platform.OS === 'ios') {
    try {
      const { StockFlowWidgetBridge } = NativeModules;
      if (StockFlowWidgetBridge?.setWidgetSnapshot) {
        await StockFlowWidgetBridge.setWidgetSnapshot(JSON.stringify(widgetData));
      } else if (StockFlowWidgetBridge?.refreshWidgets) {
        await StockFlowWidgetBridge.refreshWidgets();
      }
      console.log(
        `[WidgetSync] Native widgets updated for ${Platform.OS}: Today (${widgetData.today.completed}/${widgetData.today.total}) · Upcoming 7D (${widgetData.upcoming7Days?.total ?? 0})`
      );
    } catch (widgetError) {
      console.warn('[WidgetSync] Native widget redraw skipped or failed:', widgetError);
    }
  }

  return widgetData;
}

/**
 * Reads all tasks directly from the local offline SQLite database (`stockflow.db`),
 * computes fresh widget metrics for the current date, persists the snapshot,
 * and triggers immediate native widget redraw across Android and iOS.
 */
export async function syncWidgetDataFromDbAsync(
  baseDate: Date = new Date(),
  installationId?: string
): Promise<StockFlowWidgetData> {
  if (Platform.OS === 'web') {
    return prepareWidgetData([], baseDate);
  }

  try {
    const { getLocalTasksAsync } = require('./database');
    const tasks = await getLocalTasksAsync();
    return await syncWidgetDataAsync(tasks, baseDate, installationId);
  } catch (err) {
    console.warn('[WidgetData] syncWidgetDataFromDbAsync failed, falling back to cached snapshot:', err);
    const cached = await loadWidgetSnapshotAsync(installationId);
    if (cached) {
      const { StockFlowWidgetBridge } = NativeModules;
      if (StockFlowWidgetBridge?.refreshWidgets) {
        await StockFlowWidgetBridge.refreshWidgets().catch(() => {});
      }
      return cached;
    }
    return prepareWidgetData([], baseDate);
  }
}

/**
 * Refreshes the native Android and iOS home-screen widgets automatically.
 * Automatically loads fresh data from local SQLite for current date, falling back to cached snapshot.
 * Safe to call on app startup and on AppState transitions without hitting the network.
 */
export async function refreshWidgetFromSnapshotAsync(
  installationId?: string
): Promise<boolean> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return false;
  }

  try {
    // Attempt fresh calculation from SQLite first so new day/midnight rollover is accurate
    try {
      await syncWidgetDataFromDbAsync(new Date(), installationId);
      return true;
    } catch {
      // Fallback to pure native bridge refresh
    }

    const { StockFlowWidgetBridge } = NativeModules;
    if (StockFlowWidgetBridge?.refreshWidgets) {
      await StockFlowWidgetBridge.refreshWidgets();
      return true;
    }
    return false;
  } catch (error) {
    console.warn('[WidgetData] Failed to refresh widget from snapshot:', error);
    return false;
  }
}


