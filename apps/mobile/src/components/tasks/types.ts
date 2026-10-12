export type TaskPriority = 'low' | 'medium' | 'high';
export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export type Task = {
  id: number;
  title: string;
  description: string;
  scheduled_at: string | null;
  end_at?: string | null;
  priority: TaskPriority;
  status?: TaskStatus;
  is_completed: boolean;
  notes?: string;
  reminder_minutes?: number | null;
  created_at: string;
  updated_at: string;
};

export type UnifiedViewTab = 'today' | 'upcoming' | 'all' | 'calendar';
export type CalendarSubTab = 'day' | 'range' | 'tracker';
