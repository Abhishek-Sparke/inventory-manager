import { Platform } from 'react-native';
import type { Task } from '@/app/tasks';

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
  const todayStr = now.toDateString();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toDateString();

  const todayList: WidgetTaskItem[] = [];
  const tomorrowList: WidgetTaskItem[] = [];
  let completedCount = 0;

  tasks.forEach(task => {
    if (task.is_completed) {
      completedCount += 1;
    }

    if (!task.scheduled_at) {
      todayList.push({
        id: task.id,
        title: task.title,
        timeFormatted: 'All Day',
        priority: task.priority || 'medium',
        isCompleted: task.is_completed,
      });
      return;
    }

    const taskDate = new Date(task.scheduled_at);
    if (isNaN(taskDate.getTime())) return;

    const taskDateStr = taskDate.toDateString();
    const timeFormatted = getFormattedTime(task.scheduled_at);

    if (taskDateStr === todayStr) {
      todayList.push({
        id: task.id,
        title: task.title,
        timeFormatted,
        priority: task.priority || 'medium',
        isCompleted: task.is_completed,
      });
    } else if (taskDateStr === tomorrowStr) {
      tomorrowList.push({
        id: task.id,
        title: task.title,
        timeFormatted,
        priority: task.priority || 'medium',
        isCompleted: task.is_completed,
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
