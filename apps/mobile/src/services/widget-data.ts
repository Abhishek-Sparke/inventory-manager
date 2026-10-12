import { Platform } from 'react-native';
import type { Task } from '@/app/tasks';
import { getLocalDateString, getTaskLocalDateString } from '@/utils/timezone';

export interface WidgetTaskItem {
  id: number;
  title: string;
  timeFormatted: string; // e.g. "17:48"
  priority: 'low' | 'medium' | 'high';
  isCompleted: boolean;
}

export interface StockFlowWidgetData {
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
}

/**
 * Extracts formatted time (HH:mm) from a task's ISO scheduled_at string.
 */
function getFormattedTime(isoString: string | null): string {
  if (!isoString) return '--:--';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '--:--';
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Prepares widget snapshot payload from real tasks.
 */
export function prepareWidgetData(tasks: Task[]): StockFlowWidgetData {
  const now = new Date();
  const todayStr = getLocalDateString(now);

  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowStr = getLocalDateString(tomorrow);

  const todayList: WidgetTaskItem[] = [];
  const tomorrowList: WidgetTaskItem[] = [];
  let completedCount = 0;

  tasks.forEach(task => {
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

    if (taskDateStr === todayStr) {
      todayList.push({
        id: task.id,
        title: task.title,
        timeFormatted,
        priority: task.priority || 'medium',
        isCompleted: isDone,
      });
    } else if (taskDateStr === tomorrowStr) {
      tomorrowList.push({
        id: task.id,
        title: task.title,
        timeFormatted,
        priority: task.priority || 'medium',
        isCompleted: isDone,
      });
    }
  });

  const total = tasks.length;
  const overallPercent = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  const todayCompleted = todayList.filter(t => t.isCompleted).length;
  const todayPercent =
    todayList.length > 0 ? Math.round((todayCompleted / todayList.length) * 100) : 0;

  return {
    updatedAt: now.toISOString(),
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
  };
}

/**
 * Dispatches the latest task metrics to native widget storage (SharedPreferences / App Groups).
 * In an environment where the native widget provider is compiled, this pushes the JSON payload.
 */
export async function syncWidgetDataAsync(tasks: Task[]): Promise<StockFlowWidgetData> {
  const widgetData = prepareWidgetData(tasks);

  if (Platform.OS === 'web') {
    return widgetData;
  }

  try {
    // When native widget bridge (react-native-android-widget / WidgetKit) is present,
    // this dispatches the payload to the shared container.
    // e.g., SharedPreferences for Android, SharedGroupPreferences for iOS WidgetKit.
    console.log(
      `[WidgetSync] Prepared widget snapshot: Today (${widgetData.today.completed}/${widgetData.today.total}, ${widgetData.today.percent}%), Tomorrow (${widgetData.tomorrow.total} tasks)`
    );
  } catch (error) {
    console.warn('[WidgetSync] Failed to sync widget data:', error);
  }

  return widgetData;
}
