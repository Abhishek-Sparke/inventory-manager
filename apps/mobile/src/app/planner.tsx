import { Redirect } from 'expo-router';
import type { Task, TaskPriority, TaskStatus } from '@/components/tasks/types';
import type { DailyProgress } from '@/services/daily-progress';

export type TaskItem = Task;
export type { TaskPriority, TaskStatus, DailyProgress };

/**
 * The standalone Planner tab has been merged into the unified Tasks screen.
 * Any direct navigation or deep links to /planner redirect to /tasks with Calendar view active.
 */
export default function PlannerRedirect() {
  return <Redirect href="/tasks?view=calendar" />;
}
