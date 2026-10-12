import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Pressable,
  Alert,
  Platform,
} from 'react-native';

import { TASKS_API_URL } from '@/constants/api';
import {
  scheduleTaskReminderAsync,
  cancelTaskReminderAsync,
  getActiveReminderTaskIdsAsync,
} from '@/services/notifications';
import { syncWidgetDataAsync } from '@/services/widget-data';

export type TaskPriority = 'low' | 'medium' | 'high';

export type Task = {
  id: number;
  title: string;
  description: string;
  scheduled_at: string | null;
  priority: TaskPriority;
  is_completed: boolean;
  created_at: string;
  updated_at: string;
};

type FilterTab = 'today' | 'upcoming' | 'all';

function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseTimeString(timeStr: string): { hour: number; minute: number } {
  if (!timeStr) return { hour: 9, minute: 0 };
  const trimmed = timeStr.trim();
  const isPM = /pm$/i.test(trimmed);
  const isAM = /am$/i.test(trimmed);
  const numOnly = trimmed.replace(/[^\d:.]/g, '');

  let h = 9;
  let m = 0;

  const parts = numOnly.split(/[:.]/);
  if (parts.length >= 2) {
    h = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10);
  } else if (parts.length === 1) {
    const single = parts[0];
    if (single.length === 4) {
      h = parseInt(single.slice(0, 2), 10);
      m = parseInt(single.slice(2), 10);
    } else if (single.length === 3) {
      h = parseInt(single.slice(0, 1), 10);
      m = parseInt(single.slice(1), 10);
    } else {
      h = parseInt(single, 10);
      m = 0;
    }
  }

  if (isNaN(h)) h = 9;
  if (isNaN(m)) m = 0;

  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;

  return {
    hour: Math.min(23, Math.max(0, h)),
    minute: Math.min(59, Math.max(0, m)),
  };
}

export function parseDateString(dateStr: string): { year: number; month: number; day: number } {
  const now = new Date();
  if (!dateStr || !dateStr.trim()) {
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }

  const parts = dateStr.trim().split(/[-/.]/).map(Number);
  if (parts.length === 3) {
    if (parts[0] > 1000) {
      // YYYY-MM-DD
      return { year: parts[0], month: parts[1], day: parts[2] };
    }
    if (parts[2] > 1000) {
      // DD-MM-YYYY
      return { year: parts[2], month: parts[1], day: parts[0] };
    }
  }

  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

export function buildScheduledIsoString(dateStr: string, timeStr: string): string | null {
  if (!dateStr || !dateStr.trim()) return null;

  const { year, month, day } = parseDateString(dateStr);
  const { hour, minute } = parseTimeString(timeStr);

  const localDate = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (isNaN(localDate.getTime())) return null;

  return localDate.toISOString();
}

export function formatScheduledDisplay(isoString: string | null): {
  label: string;
  isOverdue: boolean;
  isFuture: boolean;
} {
  if (!isoString) {
    return { label: 'No scheduled date', isOverdue: false, isFuture: false };
  }

  const taskDate = new Date(isoString);
  if (isNaN(taskDate.getTime())) {
    return { label: 'Invalid date', isOverdue: false, isFuture: false };
  }

  const now = new Date();
  const isOverdue = taskDate.getTime() < now.getTime();
  const isFuture = taskDate.getTime() > now.getTime();

  const isToday = taskDate.toDateString() === now.toDateString();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = taskDate.toDateString() === tomorrow.toDateString();

  const hoursStr = String(taskDate.getHours()).padStart(2, '0');
  const minutesStr = String(taskDate.getMinutes()).padStart(2, '0');
  const timeStr = `${hoursStr}:${minutesStr}`;

  if (isToday) {
    return {
      label: `Today at ${timeStr}`,
      isOverdue,
      isFuture,
    };
  }

  if (isTomorrow) {
    return {
      label: `Tomorrow at ${timeStr}`,
      isOverdue: false,
      isFuture: true,
    };
  }

  const dateStr = taskDate.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return {
    label: `${dateStr} · ${timeStr}`,
    isOverdue,
    isFuture,
  };
}

export default function TasksScreen() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('today');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<number | null>(null);

  // Active reminder IDs tracked in OS notification queue
  const [reminderTaskIds, setReminderTaskIds] = useState<Set<number>>(new Set());

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPriority, setFormPriority] = useState<TaskPriority>('medium');
  const [formDate, setFormDate] = useState(getLocalDateString());
  const [formTime, setFormTime] = useState('09:00');
  const [formReminderEnabled, setFormReminderEnabled] = useState(true);
  const [formReminderOffset, setFormReminderOffset] = useState<number>(0);

  const loadTasks = useCallback(async (pullToRefresh = false) => {
    if (pullToRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError('');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(TASKS_API_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`API returned HTTP ${response.status}`);
      }

      const data = await response.json();
      const taskList = Array.isArray(data)
        ? data
        : Array.isArray(data.results)
          ? data.results
          : [];

      setTasks(taskList);

      // Sync active scheduled notifications from local device
      const activeReminders = await getActiveReminderTaskIdsAsync();
      setReminderTaskIds(activeReminders);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'Request timed out after 15 seconds. Check the server and network.'
            : `${err.name}: ${err.message}`
          : String(err);
      setError(message);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (tasks.length > 0) {
      syncWidgetDataAsync(tasks);
    }
  }, [tasks]);

  // Tab Filtering, Timezone Grouping & Progress Metrics
  const {
    todayTasks,
    upcomingTasks,
    allTasks,
    totalTasks,
    totalCompleted,
    overallPercent,
    todayTotal,
    todayCompleted,
    todayPercent,
    weekTotal,
    weekCompleted,
    weekPercent,
    pendingCount,
    overdueCount,
  } = useMemo(() => {
    const now = new Date();
    const todayStr = now.toDateString();

    // Start of week (Monday 00:00:00) and end of week (Sunday 23:59:59.999)
    const currentDayOfWeek = now.getDay();
    const distanceToMonday = (currentDayOfWeek + 6) % 7;
    const startOfWeek = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - distanceToMonday,
      0,
      0,
      0,
      0
    );
    const endOfWeek = new Date(
      startOfWeek.getFullYear(),
      startOfWeek.getMonth(),
      startOfWeek.getDate() + 7,
      0,
      0,
      0,
      -1
    );

    const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const endOfSevenDays = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 8,
      0,
      0,
      0,
      -1
    );

    const todayList: Task[] = [];
    const upcomingList: Task[] = [];
    const weekList: Task[] = [];
    let pending = 0;
    let overdue = 0;
    let completed = 0;

    tasks.forEach(task => {
      if (task.is_completed) {
        completed += 1;
      } else {
        pending += 1;
      }

      // Overdue: task not completed and scheduled date has passed
      if (!task.is_completed && task.scheduled_at) {
        const taskDate = new Date(task.scheduled_at);
        if (!isNaN(taskDate.getTime()) && taskDate.getTime() < now.getTime()) {
          overdue += 1;
        }
      }

      if (!task.scheduled_at) {
        todayList.push(task);
        weekList.push(task);
        return;
      }

      const taskDate = new Date(task.scheduled_at);
      if (isNaN(taskDate.getTime())) {
        todayList.push(task);
        weekList.push(task);
        return;
      }

      const isToday = taskDate.toDateString() === todayStr;
      const isPast = taskDate < now;

      if (isToday || (isPast && !task.is_completed)) {
        todayList.push(task);
      } else if (taskDate >= startOfTomorrow && taskDate <= endOfSevenDays) {
        upcomingList.push(task);
      }

      // Workload for current week
      if (taskDate >= startOfWeek && taskDate <= endOfWeek) {
        weekList.push(task);
      } else if (isPast && !task.is_completed) {
        weekList.push(task);
      }
    });

    const totalTasksCount = tasks.length;
    const overallPercentage =
      totalTasksCount > 0 ? Math.round((completed / totalTasksCount) * 100) : 0;

    const todayTotalCount = todayList.length;
    const todayCompletedCount = todayList.filter(t => t.is_completed).length;
    const todayPercentage =
      todayTotalCount > 0 ? Math.round((todayCompletedCount / todayTotalCount) * 100) : 0;

    const weekTotalCount = weekList.length;
    const weekCompletedCount = weekList.filter(t => t.is_completed).length;
    const weekPercentage =
      weekTotalCount > 0 ? Math.round((weekCompletedCount / weekTotalCount) * 100) : 0;

    return {
      todayTasks: todayList,
      upcomingTasks: upcomingList,
      allTasks: tasks,
      totalTasks: totalTasksCount,
      totalCompleted: completed,
      overallPercent: overallPercentage,
      todayTotal: todayTotalCount,
      todayCompleted: todayCompletedCount,
      todayPercent: todayPercentage,
      weekTotal: weekTotalCount,
      weekCompleted: weekCompletedCount,
      weekPercent: weekPercentage,
      pendingCount: pending,
      overdueCount: overdue,
    };
  }, [tasks]);

  const displayedTasks = useMemo(() => {
    if (activeTab === 'today') return todayTasks;
    if (activeTab === 'upcoming') return upcomingTasks;
    return allTasks;
  }, [activeTab, todayTasks, upcomingTasks, allTasks]);

  // Actions
  async function handleToggleTask(task: Task) {
    const targetStatus = !task.is_completed;

    // Optimistic update
    setTasks(prev =>
      prev.map(t => (t.id === task.id ? { ...t, is_completed: targetStatus } : t))
    );

    // Cancel or reschedule reminder according to completion status
    if (targetStatus) {
      // Completed: cancel notification
      await cancelTaskReminderAsync(task.id);
      setReminderTaskIds(prev => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    } else if (task.scheduled_at) {
      // Uncompleted: re-schedule if still in future
      const res = await scheduleTaskReminderAsync({ ...task, is_completed: false });
      if (res.success) {
        setReminderTaskIds(prev => new Set(prev).add(task.id));
      }
    }

    try {
      const response = await fetch(`${TASKS_API_URL}${task.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_completed: targetStatus }),
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const updated = await response.json();
      setTasks(prev => prev.map(t => (t.id === task.id ? updated : t)));
    } catch (err) {
      // Revert on error
      setTasks(prev =>
        prev.map(t => (t.id === task.id ? { ...t, is_completed: !targetStatus } : t))
      );
      Alert.alert(
        'Update failed',
        err instanceof Error ? err.message : 'Could not update task status.'
      );
    }
  }

  async function performDelete(task: Task) {
    const deleteUrl = `${TASKS_API_URL.replace(/\/$/, '')}/${task.id}/`;
    console.log(`[Tasks] Initiating DELETE for task ID ${task.id} ("${task.title}") at: ${deleteUrl}`);

    setDeletingTaskId(task.id);

    try {
      const response = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
        },
      });

      console.log(`[Tasks] DELETE response status: ${response.status} for task ID ${task.id}`);

      if (!response.ok) {
        let errorDetail = `HTTP ${response.status}`;
        try {
          const errData = await response.json();
          errorDetail = errData?.detail || JSON.stringify(errData);
        } catch {
          // Response body was empty or not JSON
        }
        throw new Error(`Server returned status ${response.status}: ${errorDetail}`);
      }

      console.log(`[Tasks] Successfully deleted task ID ${task.id} ("${task.title}") from server.`);

      // 1. Remove task from UI only after server confirmation
      setTasks(prev => prev.filter(t => t.id !== task.id));

      // 2. Cancel local reminder on native devices if active (no-op on web)
      await cancelTaskReminderAsync(task.id);
      setReminderTaskIds(prev => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Could not delete task.';
      console.error(`[Tasks] DELETE failed for task ID ${task.id}:`, errorMsg);

      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.alert) {
        window.alert(`Delete failed: ${errorMsg}`);
      } else {
        Alert.alert('Delete failed', errorMsg);
      }
    } finally {
      setDeletingTaskId(null);
    }
  }

  function handleDeleteTask(task: Task) {
    const promptMsg = `Delete "${task.title}"? This cannot be undone.`;

    if (Platform.OS === 'web') {
      const confirmed =
        typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm(promptMsg)
          : true;

      if (confirmed) {
        performDelete(task);
      }
    } else {
      Alert.alert(
        'Delete Task',
        promptMsg,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              performDelete(task);
            },
          },
        ]
      );
    }
  }

  async function handleToggleReminder(task: Task) {
    if (task.is_completed) {
      Alert.alert('Task Completed', 'Cannot set reminders for completed tasks.');
      return;
    }

    if (!task.scheduled_at) {
      Alert.alert('No Schedule', 'Set a scheduled date and time to enable reminders for this task.');
      return;
    }

    const isScheduled = reminderTaskIds.has(task.id);

    if (isScheduled) {
      await cancelTaskReminderAsync(task.id);
      setReminderTaskIds(prev => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
      Alert.alert('Reminder Removed', `Notification for "${task.title}" was cancelled.`);
    } else {
      const res = await scheduleTaskReminderAsync(task, 0);
      if (res.success) {
        setReminderTaskIds(prev => new Set(prev).add(task.id));
        const timeDisplay = res.triggerDate.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        Alert.alert(
          'Reminder Scheduled',
          `You will receive an alert on this device at ${timeDisplay}! 🔔`
        );
      } else if (res.reason === 'past') {
        Alert.alert('Past Date', 'The scheduled date and time for this task has already passed.');
      } else if (res.reason === 'permission_denied') {
        Alert.alert('Permission Denied', 'Please grant notification permissions in phone settings.');
      } else if (res.reason === 'platform_unsupported') {
        Alert.alert(
          'Reminders in Expo Go',
          res.message || 'Local notifications require an EAS development build or standalone APK.'
        );
      }
    }
  }

  async function handleCreateTask() {
    if (!formTitle.trim()) {
      Alert.alert('Required field', 'Please enter a task title.');
      return;
    }

    setSaving(true);

    try {
      // Build local date object with exact minute precision and convert to ISO string
      const isoTimestamp = buildScheduledIsoString(formDate, formTime);

      const payload = {
        title: formTitle.trim(),
        description: formDescription.trim(),
        priority: formPriority,
        scheduled_at: isoTimestamp,
        is_completed: false,
      };

      const response = await fetch(TASKS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const msg = Object.entries(errorData)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join('\n');
        throw new Error(msg || `Server returned ${response.status}`);
      }

      const created: Task = await response.json();
      setTasks(prev => [created, ...prev]);

      // Schedule local notification if enabled
      let reminderInfo = '';
      if (formReminderEnabled && created.scheduled_at) {
        const scheduleResult = await scheduleTaskReminderAsync(
          created,
          formReminderOffset
        );

        if (scheduleResult.success) {
          setReminderTaskIds(prev => new Set(prev).add(created.id));
          const timeDisplay = scheduleResult.triggerDate.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          reminderInfo = `\n\n🔔 Local reminder set for ${timeDisplay}!`;
        } else if (scheduleResult.reason === 'past') {
          reminderInfo = '\n\n⚠️ Reminder skipped: the chosen time has already passed.';
        } else if (scheduleResult.reason === 'permission_denied') {
          reminderInfo = '\n\n⚠️ Reminder skipped: notification permission not granted.';
        } else if (scheduleResult.reason === 'platform_unsupported') {
          reminderInfo = '\n\nℹ️ Note: Native notifications require a standalone APK or dev build (skipped in Expo Go).';
        }
      }

      // Reset form
      setFormTitle('');
      setFormDescription('');
      setFormPriority('medium');
      setFormDate(getLocalDateString());
      setFormTime('09:00');
      setFormReminderEnabled(true);
      setFormReminderOffset(0);
      setShowForm(false);

      Alert.alert('Task Created', `Task added successfully!${reminderInfo}`);
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Could not create task.'
      );
    } finally {
      setSaving(false);
    }
  }

  // Quick Date Helpers
  function setDatePreset(daysFromNow: number, timeStr = '09:00') {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    setFormDate(getLocalDateString(d));
    setFormTime(timeStr);
  }

  return (
    <ScrollView
      style={styles.screen}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => loadTasks(true)}
        />
      }
    >
      <StatusBar barStyle="light-content" backgroundColor="#172033" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.logo}>S</Text>
        <View>
          <Text style={styles.brand}>StockFlow</Text>
          <Text style={styles.subtitle}>Task & Workflow Management</Text>
        </View>
      </View>

      {/* Welcome / Dashboard Section */}
      <View style={styles.welcome}>
        <View style={styles.titleRow}>
          <View>
            <Text style={styles.greeting}>Task Center</Text>
            <Text style={styles.description}>
              {pendingCount === 0
                ? 'All tasks completed! Great work.'
                : `${pendingCount} pending task${pendingCount === 1 ? '' : 's'} to complete.`}
            </Text>
          </View>
          <Pressable
            style={styles.primaryButton}
            onPress={() => setShowForm(!showForm)}
          >
            <Text style={styles.primaryButtonText}>
              {showForm ? 'Cancel' : '+ New Task'}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Task Progress Dashboard Section */}
      <View style={styles.progressCard}>
        <View style={styles.progressHeader}>
          <View style={styles.progressTitleCol}>
            <Text style={styles.progressSectionTitle}>Task Progress</Text>
            <Text style={styles.progressSectionSubtitle}>
              {totalTasks === 0
                ? 'No tasks scheduled yet'
                : `${totalCompleted} of ${totalTasks} task${totalTasks === 1 ? '' : 's'} completed`}
            </Text>
          </View>
          <View
            style={[
              styles.overallPercentBadge,
              overallPercent === 100 && styles.overallPercentBadgeComplete,
            ]}
          >
            <Text
              style={[
                styles.overallPercentText,
                overallPercent === 100 && styles.overallPercentTextComplete,
              ]}
            >
              {overallPercent}%
            </Text>
          </View>
        </View>

        {/* Overall Progress Bar */}
        <View style={styles.progressBarTrack}>
          <View
            style={[
              styles.progressBarFill,
              {
                width: `${Math.min(100, Math.max(0, overallPercent))}%`,
                backgroundColor: overallPercent === 100 ? '#059669' : '#4263EB',
              },
            ]}
          />
        </View>

        {/* Today & Current Week Progress Bars */}
        <View style={styles.progressBreakdownContainer}>
          {/* Today's Progress */}
          <View style={styles.progressRow}>
            <View style={styles.progressRowHeader}>
              <View style={styles.progressRowTitleWrap}>
                <Text style={styles.progressRowDotToday}>●</Text>
                <Text style={styles.progressRowLabel}>Today's Tasks</Text>
              </View>
              <Text style={styles.progressRowCount}>
                {todayCompleted}/{todayTotal} ({todayPercent}%)
              </Text>
            </View>
            <View style={styles.miniProgressBarTrack}>
              <View
                style={[
                  styles.miniProgressBarFill,
                  {
                    width: `${Math.min(100, Math.max(0, todayPercent))}%`,
                    backgroundColor: todayPercent === 100 ? '#059669' : '#4263EB',
                  },
                ]}
              />
            </View>
          </View>

          {/* Current Week's Progress */}
          <View style={styles.progressRow}>
            <View style={styles.progressRowHeader}>
              <View style={styles.progressRowTitleWrap}>
                <Text style={styles.progressRowDotWeek}>●</Text>
                <Text style={styles.progressRowLabel}>This Week's Tasks</Text>
              </View>
              <Text style={styles.progressRowCount}>
                {weekCompleted}/{weekTotal} ({weekPercent}%)
              </Text>
            </View>
            <View style={styles.miniProgressBarTrack}>
              <View
                style={[
                  styles.miniProgressBarFill,
                  {
                    width: `${Math.min(100, Math.max(0, weekPercent))}%`,
                    backgroundColor: weekPercent === 100 ? '#059669' : '#0284C7',
                  },
                ]}
              />
            </View>
          </View>
        </View>

        {/* Status Summary Counters: Pending, Overdue, Completed */}
        <View style={styles.statusPillsRow}>
          <View style={styles.statusPillPending}>
            <Text style={styles.statusPillPendingLabel}>Pending</Text>
            <Text style={styles.statusPillPendingValue}>{pendingCount}</Text>
          </View>
          <View
            style={[
              styles.statusPillOverdue,
              overdueCount > 0 && styles.statusPillOverdueAlert,
            ]}
          >
            <Text
              style={[
                styles.statusPillOverdueLabel,
                overdueCount > 0 && styles.statusPillOverdueLabelAlert,
              ]}
            >
              Overdue
            </Text>
            <Text
              style={[
                styles.statusPillOverdueValue,
                overdueCount > 0 && styles.statusPillOverdueValueAlert,
              ]}
            >
              {overdueCount}
            </Text>
          </View>
          <View style={styles.statusPillCompleted}>
            <Text style={styles.statusPillCompletedLabel}>Completed</Text>
            <Text style={styles.statusPillCompletedValue}>{totalCompleted}</Text>
          </View>
        </View>
      </View>

      {/* Overview Metric Cards */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Due Today</Text>
          <Text style={[styles.statValue, { color: '#4263EB' }]}>
            {todayTasks.filter(t => !t.is_completed).length}
          </Text>
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Next 7 Days</Text>
          <Text style={[styles.statValue, { color: '#0284C7' }]}>
            {upcomingTasks.filter(t => !t.is_completed).length}
          </Text>
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Total Tasks</Text>
          <Text style={styles.statValue}>{tasks.length}</Text>
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Completed</Text>
          <Text style={[styles.statValue, { color: '#059669' }]}>
            {tasks.filter(t => t.is_completed).length}
          </Text>
        </View>
      </View>

      {/* Add Task Form Card */}
      {showForm && (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Schedule New Task</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Title *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Conduct inventory count for aisle 3"
              placeholderTextColor="#94A3B8"
              value={formTitle}
              onChangeText={setFormTitle}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Description</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              placeholder="Add optional notes, details, or steps"
              placeholderTextColor="#94A3B8"
              value={formDescription}
              onChangeText={setFormDescription}
              multiline
              numberOfLines={3}
            />
          </View>

          {/* Priority Selector */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Priority</Text>
            <View style={styles.prioritySelector}>
              {(['low', 'medium', 'high'] as const).map(p => {
                const isSelected = formPriority === p;
                return (
                  <Pressable
                    key={p}
                    style={[
                      styles.priorityOption,
                      isSelected && styles.priorityOptionSelected,
                      isSelected &&
                        p === 'high' && { backgroundColor: '#FEE2E2', borderColor: '#EF4444' },
                      isSelected &&
                        p === 'medium' && { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' },
                      isSelected &&
                        p === 'low' && { backgroundColor: '#E0E7FF', borderColor: '#6366F1' },
                    ]}
                    onPress={() => setFormPriority(p)}
                  >
                    <Text
                      style={[
                        styles.priorityOptionText,
                        isSelected && { fontWeight: '700' },
                        isSelected && p === 'high' && { color: '#B91C1C' },
                        isSelected && p === 'medium' && { color: '#92400E' },
                        isSelected && p === 'low' && { color: '#3730A3' },
                      ]}
                    >
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Date & Time Settings */}
          <View style={styles.inputRow}>
            <View style={[styles.inputGroup, { flex: 1.2 }]}>
              <Text style={styles.inputLabel}>Scheduled Date (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94A3B8"
                value={formDate}
                onChangeText={setFormDate}
              />
            </View>

            <View style={[styles.inputGroup, { flex: 0.8 }]}>
              <Text style={styles.inputLabel}>Time (HH:MM)</Text>
              <TextInput
                style={styles.input}
                placeholder="09:00"
                placeholderTextColor="#94A3B8"
                value={formTime}
                onChangeText={setFormTime}
              />
            </View>
          </View>

          {/* Quick Date Presets */}
          <View style={styles.presetRow}>
            <Pressable
              style={styles.presetChip}
              onPress={() => setDatePreset(0, '09:00')}
            >
              <Text style={styles.presetChipText}>Today 9 AM</Text>
            </Pressable>
            <Pressable
              style={styles.presetChip}
              onPress={() => setDatePreset(1, '09:00')}
            >
              <Text style={styles.presetChipText}>Tomorrow</Text>
            </Pressable>
            <Pressable
              style={styles.presetChip}
              onPress={() => setDatePreset(3, '09:00')}
            >
              <Text style={styles.presetChipText}>In 3 Days</Text>
            </Pressable>
            <Pressable
              style={styles.presetChip}
              onPress={() => setDatePreset(7, '09:00')}
            >
              <Text style={styles.presetChipText}>Next Week</Text>
            </Pressable>
          </View>

          {/* Local Reminder Configuration */}
          <View style={styles.reminderCard}>
            <Pressable
              style={styles.reminderToggleRow}
              onPress={() => setFormReminderEnabled(!formReminderEnabled)}
            >
              <View
                style={[
                  styles.switchTrack,
                  formReminderEnabled && styles.switchTrackActive,
                ]}
              >
                <View
                  style={[
                    styles.switchThumb,
                    formReminderEnabled && styles.switchThumbActive,
                  ]}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.reminderToggleTitle}>
                  🔔 Enable local phone reminder
                </Text>
                <Text style={styles.reminderToggleSubtitle}>
                  Trigger an audible notification on this device
                </Text>
              </View>
            </Pressable>

            {formReminderEnabled && (
              <View style={styles.offsetSection}>
                <Text style={styles.offsetHeading}>Alert Timing:</Text>
                <View style={styles.offsetOptionsGrid}>
                  {[
                    { label: 'At due time', value: 0 },
                    { label: '15m before', value: 15 },
                    { label: '1 hour before', value: 60 },
                    { label: '1 day before', value: 1440 },
                  ].map(opt => {
                    const isPicked = formReminderOffset === opt.value;
                    return (
                      <Pressable
                        key={opt.value}
                        style={[
                          styles.offsetChip,
                          isPicked && styles.offsetChipSelected,
                        ]}
                        onPress={() => setFormReminderOffset(opt.value)}
                      >
                        <Text
                          style={[
                            styles.offsetChipText,
                            isPicked && styles.offsetChipTextSelected,
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
          </View>

          {/* Submit Button */}
          <Pressable
            style={[styles.saveButton, saving && { opacity: 0.7 }]}
            disabled={saving}
            onPress={handleCreateTask}
          >
            <Text style={styles.saveButtonText}>
              {saving ? 'Scheduling Task...' : 'Save & Schedule Task'}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Segmented Filter Bar */}
      <View style={styles.tabsContainer}>
        <Pressable
          style={[styles.tabButton, activeTab === 'today' && styles.tabButtonActive]}
          onPress={() => setActiveTab('today')}
        >
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'today' && styles.tabButtonTextActive,
            ]}
          >
            Today ({todayTasks.length})
          </Text>
        </Pressable>

        <Pressable
          style={[
            styles.tabButton,
            activeTab === 'upcoming' && styles.tabButtonActive,
          ]}
          onPress={() => setActiveTab('upcoming')}
        >
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'upcoming' && styles.tabButtonTextActive,
            ]}
          >
            Upcoming 7D ({upcomingTasks.length})
          </Text>
        </Pressable>

        <Pressable
          style={[styles.tabButton, activeTab === 'all' && styles.tabButtonActive]}
          onPress={() => setActiveTab('all')}
        >
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'all' && styles.tabButtonTextActive,
            ]}
          >
            All Tasks ({allTasks.length})
          </Text>
        </Pressable>
      </View>

      {/* State Handlers */}
      {loading ? (
        <View style={styles.message}>
          <ActivityIndicator size="large" color="#4263EB" />
          <Text style={styles.messageText}>Loading tasks from StockFlow...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Connection Failed</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => loadTasks()}>
            <Text style={styles.retryButtonText}>Tap here to retry</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.taskList}>
          {displayedTasks.map(task => {
            const { label: dateLabel, isOverdue, isFuture } = formatScheduledDisplay(
              task.scheduled_at
            );
            const hasReminder = reminderTaskIds.has(task.id);

            return (
              <View
                key={task.id}
                style={[
                  styles.taskCard,
                  task.is_completed && styles.taskCardCompleted,
                ]}
              >
                <View style={styles.taskCardRow}>
                  {/* Checkbox */}
                  <Pressable
                    style={[
                      styles.checkbox,
                      task.is_completed && styles.checkboxCompleted,
                    ]}
                    onPress={() => handleToggleTask(task)}
                    accessibilityLabel={
                      task.is_completed ? 'Mark task pending' : 'Mark task completed'
                    }
                  >
                    {task.is_completed && (
                      <Text style={styles.checkboxCheckmark}>✓</Text>
                    )}
                  </Pressable>

                  {/* Task Content */}
                  <View style={styles.taskContent}>
                    <Text
                      style={[
                        styles.taskTitle,
                        task.is_completed && styles.taskTitleCompleted,
                      ]}
                    >
                      {task.title}
                    </Text>

                    {Boolean(task.description) && (
                      <Text
                        style={[
                          styles.taskDescription,
                          task.is_completed && styles.taskDescriptionCompleted,
                        ]}
                        numberOfLines={2}
                      >
                        {task.description}
                      </Text>
                    )}

                    {/* Metadata Badges */}
                    <View style={styles.taskMetaRow}>
                      {/* Priority Badge */}
                      <View
                        style={[
                          styles.badge,
                          task.priority === 'high' && styles.badgeHigh,
                          task.priority === 'medium' && styles.badgeMedium,
                          task.priority === 'low' && styles.badgeLow,
                        ]}
                      >
                        <Text
                          style={[
                            styles.badgeText,
                            task.priority === 'high' && styles.badgeTextHigh,
                            task.priority === 'medium' && styles.badgeTextMedium,
                            task.priority === 'low' && styles.badgeTextLow,
                          ]}
                        >
                          {task.priority.toUpperCase()}
                        </Text>
                      </View>

                      {/* Scheduled Date */}
                      <Text
                        style={[
                          styles.dateText,
                          isOverdue && !task.is_completed && styles.dateTextOverdue,
                          task.is_completed && styles.dateTextCompleted,
                        ]}
                      >
                        {isOverdue && !task.is_completed ? '⚠️ ' : '📅 '}
                        {dateLabel}
                      </Text>

                      {/* Reminder Status Badge & Action */}
                      {!task.is_completed && hasReminder && (
                        <Pressable
                          style={styles.reminderBadgeActive}
                          onPress={() => handleToggleReminder(task)}
                        >
                          <Text style={styles.reminderTextActive}>
                            🔔 Alert Active
                          </Text>
                        </Pressable>
                      )}

                      {!task.is_completed && !hasReminder && isFuture && (
                        <Pressable
                          style={styles.reminderBadgeInactive}
                          onPress={() => handleToggleReminder(task)}
                        >
                          <Text style={styles.reminderTextInactive}>
                            + 🔔 Set Alert
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>

                  {/* Delete Button */}
                  <Pressable
                    style={[
                      styles.deleteButton,
                      deletingTaskId === task.id && { opacity: 0.5 },
                    ]}
                    disabled={deletingTaskId === task.id}
                    onPress={() => handleDeleteTask(task)}
                    accessibilityLabel="Delete task"
                  >
                    {deletingTaskId === task.id ? (
                      <ActivityIndicator size="small" color="#DC2626" />
                    ) : (
                      <Text style={styles.deleteButtonText}>✕</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            );
          })}

          {displayedTasks.length === 0 && (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>
                {activeTab === 'today'
                  ? '🎉'
                  : activeTab === 'upcoming'
                    ? '🗓️'
                    : '📋'}
              </Text>
              <Text style={styles.emptyTitle}>
                {activeTab === 'today'
                  ? 'No tasks due today'
                  : activeTab === 'upcoming'
                    ? 'No upcoming tasks for the next 7 days'
                    : 'No tasks scheduled yet'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {activeTab === 'today'
                  ? "You're all caught up for today! Tap '+ New Task' above to add one."
                  : 'Tap the button above to plan ahead.'}
              </Text>
            </View>
          )}
        </View>
      )}

      <Text style={styles.footer}>StockFlow · Tasks & Inventory</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F3F6FB' },

  header: {
    backgroundColor: '#172033',
    paddingHorizontal: 22,
    paddingTop: 54,
    paddingBottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logo: {
    backgroundColor: '#4263EB',
    color: '#FFFFFF',
    fontSize: 25,
    fontWeight: '800',
    width: 48,
    height: 48,
    textAlign: 'center',
    textAlignVertical: 'center',
    borderRadius: 14,
    overflow: 'hidden',
  },
  brand: { color: '#FFFFFF', fontSize: 23, fontWeight: '800' },
  subtitle: { color: '#B9C4D8', fontSize: 13, marginTop: 3 },

  welcome: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: { color: '#172033', fontSize: 28, fontWeight: '800' },
  description: { color: '#64748B', fontSize: 14, marginTop: 4 },

  primaryButton: {
    backgroundColor: '#4263EB',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
  },
  statCard: {
    width: '46%',
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
    margin: 6,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statLabel: { color: '#64748B', fontSize: 13 },
  statValue: {
    color: '#172033',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 8,
  },

  tabsContainer: {
    flexDirection: 'row',
    marginHorizontal: 18,
    marginTop: 18,
    marginBottom: 12,
    backgroundColor: '#E2E8F0',
    padding: 4,
    borderRadius: 12,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 9,
  },
  tabButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabButtonText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },
  tabButtonTextActive: {
    color: '#172033',
    fontWeight: '700',
  },

  formCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 18,
    marginVertical: 14,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  formTitle: {
    color: '#172033',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 14,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
  },
  inputLabel: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#172033',
    backgroundColor: '#FFFFFF',
    fontSize: 14,
  },
  multilineInput: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  prioritySelector: {
    flexDirection: 'row',
    gap: 8,
  },
  priorityOption: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  priorityOptionSelected: {
    borderWidth: 1.5,
  },
  priorityOptionText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  presetChip: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  presetChipText: {
    color: '#4263EB',
    fontSize: 12,
    fontWeight: '600',
  },

  reminderCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  reminderToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  switchTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#CBD5E1',
    padding: 2,
    justifyContent: 'center',
  },
  switchTrackActive: {
    backgroundColor: '#4263EB',
  },
  switchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  switchThumbActive: {
    alignSelf: 'flex-end',
  },
  reminderToggleTitle: {
    color: '#172033',
    fontSize: 14,
    fontWeight: '700',
  },
  reminderToggleSubtitle: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },
  offsetSection: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  offsetHeading: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  offsetOptionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  offsetChip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  offsetChipSelected: {
    backgroundColor: '#EEF2FF',
    borderColor: '#4263EB',
  },
  offsetChipText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  offsetChipTextSelected: {
    color: '#4263EB',
    fontWeight: '700',
  },

  saveButton: {
    backgroundColor: '#4263EB',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  taskList: {
    paddingHorizontal: 18,
    paddingBottom: 20,
  },
  taskCard: {
    backgroundColor: '#FFFFFF',
    marginBottom: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  taskCardCompleted: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    opacity: 0.85,
  },
  taskCardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    backgroundColor: '#FFFFFF',
  },
  checkboxCompleted: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  checkboxCheckmark: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 16,
  },
  taskContent: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#172033',
  },
  taskTitleCompleted: {
    textDecorationLine: 'line-through',
    color: '#94A3B8',
  },
  taskDescription: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 18,
  },
  taskDescriptionCompleted: {
    color: '#CBD5E1',
  },
  taskMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeHigh: { backgroundColor: '#FEE2E2' },
  badgeMedium: { backgroundColor: '#FEF3C7' },
  badgeLow: { backgroundColor: '#E0E7FF' },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  badgeTextHigh: { color: '#B91C1C' },
  badgeTextMedium: { color: '#92400E' },
  badgeTextLow: { color: '#3730A3' },
  dateText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  dateTextOverdue: {
    color: '#DC2626',
    fontWeight: '700',
  },
  dateTextCompleted: {
    color: '#94A3B8',
  },

  reminderBadgeActive: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  reminderTextActive: {
    color: '#4263EB',
    fontSize: 11,
    fontWeight: '700',
  },
  reminderBadgeInactive: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  reminderTextInactive: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
  },

  deleteButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  deleteButtonText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '700',
  },

  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyEmoji: {
    fontSize: 42,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#172033',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
  },

  message: { alignItems: 'center', padding: 40 },
  messageText: { color: '#64748B', textAlign: 'center', marginTop: 12 },

  errorCard: {
    backgroundColor: '#FFFFFF',
    margin: 18,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorTitle: { color: '#B91C1C', fontSize: 18, fontWeight: '800' },
  errorText: { color: '#475569', marginTop: 8, lineHeight: 21 },
  retryButton: {
    marginTop: 14,
    alignSelf: 'flex-start',
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryButtonText: { color: '#4263EB', fontWeight: '700', fontSize: 13 },

  footer: {
    textAlign: 'center',
    color: '#94A3B8',
    marginTop: 20,
    marginBottom: 40,
    fontSize: 12,
  },

  // Progress Dashboard Styles
  progressCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  progressTitleCol: {
    flex: 1,
  },
  progressSectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#172033',
  },
  progressSectionSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  overallPercentBadge: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  overallPercentBadgeComplete: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  overallPercentText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#4263EB',
  },
  overallPercentTextComplete: {
    color: '#059669',
  },
  progressBarTrack: {
    height: 10,
    backgroundColor: '#E2E8F0',
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: 16,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 5,
  },
  progressBreakdownContainer: {
    gap: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    marginBottom: 14,
  },
  progressRow: {
    gap: 6,
  },
  progressRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressRowTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressRowDotToday: {
    color: '#4263EB',
    fontSize: 10,
  },
  progressRowDotWeek: {
    color: '#0284C7',
    fontSize: 10,
  },
  progressRowLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  progressRowCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  miniProgressBarTrack: {
    height: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 3,
    overflow: 'hidden',
  },
  miniProgressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  statusPillsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statusPillPending: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statusPillPendingLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  statusPillPendingValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E293B',
    marginTop: 2,
  },
  statusPillOverdue: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statusPillOverdueAlert: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  statusPillOverdueLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  statusPillOverdueLabelAlert: {
    color: '#DC2626',
    fontWeight: '700',
  },
  statusPillOverdueValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E293B',
    marginTop: 2,
  },
  statusPillOverdueValueAlert: {
    color: '#DC2626',
  },
  statusPillCompleted: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  statusPillCompletedLabel: {
    fontSize: 11,
    color: '#166534',
    fontWeight: '600',
  },
  statusPillCompletedValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#15803D',
    marginTop: 2,
  },
});
