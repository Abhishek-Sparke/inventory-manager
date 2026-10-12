import { Task } from '@/components/tasks/types';
import { getLocalDateString, getTaskLocalDateString } from './timezone';

export interface DailyTaskProgressMetrics {
  todayTotal: number;
  todayCompleted: number;
  todayPercent: number;
  overallTotal: number;
  overallCompleted: number;
  overallPercent: number;
}

/**
 * Calculates task progress metrics strictly isolating tasks due today.
 *
 * Progress formula:
 * completed tasks due today / total tasks due today * 100
 *
 * Safe handling:
 * When total tasks due today is 0, progress is 0 (prevents division by zero / NaN).
 * Tasks scheduled for other dates or unscheduled tasks do not affect today's progress.
 */
export function calculateDailyTaskProgress(
  tasks: Task[],
  todayLocalDateStr?: string
): DailyTaskProgressMetrics {
  const targetDate = todayLocalDateStr || getLocalDateString(new Date());

  let todayTotal = 0;
  let todayCompleted = 0;
  let overallCompleted = 0;

  for (const task of tasks) {
    const isDone = Boolean(task.is_completed || task.status === 'completed');
    if (isDone) {
      overallCompleted += 1;
    }

    if (!task.scheduled_at) {
      continue;
    }

    const taskDate = getTaskLocalDateString(task.scheduled_at);
    if (taskDate === targetDate) {
      todayTotal += 1;
      if (isDone) {
        todayCompleted += 1;
      }
    }
  }

  const overallTotal = tasks.length;
  const overallPercent =
    overallTotal > 0 ? Math.round((overallCompleted / overallTotal) * 100) : 0;

  const todayPercent =
    todayTotal > 0 ? Math.round((todayCompleted / todayTotal) * 100) : 0;

  return {
    todayTotal,
    todayCompleted,
    todayPercent,
    overallTotal,
    overallCompleted,
    overallPercent,
  };
}
