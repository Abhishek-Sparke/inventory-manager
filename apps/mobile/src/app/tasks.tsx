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
  rescheduleAllPendingTaskRemindersAsync,
} from '@/services/notifications';
import { syncWidgetDataAsync } from '@/services/widget-data';
import {
  getLocalDateString,
  getTaskLocalDateString,
  formatLocalTime,
  parseTimeString,
  parseDateString,
  buildScheduledIsoString,
  formatScheduledDisplay,
  isTaskOverdue,
} from '@/utils/timezone';

// Re-export timezone helpers so existing imports continue working without regression
export {
  getLocalDateString,
  parseTimeString,
  parseDateString,
  buildScheduledIsoString,
  formatScheduledDisplay,
};

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

type FilterTab = 'today' | 'upcoming' | 'all';

export default function TasksScreen() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('today');
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<number | null>(null);

  // Active reminder IDs tracked in OS notification queue
  const [reminderTaskIds, setReminderTaskIds] = useState<Set<number>>(new Set());

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPriority, setFormPriority] = useState<TaskPriority>('medium');
  const [formDate, setFormDate] = useState(() => getLocalDateString());
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
      const taskList: Task[] = Array.isArray(data)
        ? data
        : Array.isArray(data.results)
          ? data.results
          : [];

      setTasks(taskList);

      // Sync active scheduled notifications from local device
      const activeReminders = await getActiveReminderTaskIdsAsync();
      setReminderTaskIds(activeReminders);

      // Restore alarms if needed for pending future tasks
      await rescheduleAllPendingTaskRemindersAsync(taskList);
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
    overdueTasks,
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
    const todayStr = getLocalDateString(now);

    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const startOfTomorrow = tomorrow.getTime();
    const endOfSevenDays = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 8,
      0,
      0,
      0,
      -1
    ).getTime();

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
    ).getTime();
    const endOfWeek = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - distanceToMonday + 7,
      0,
      0,
      0,
      -1
    ).getTime();

    const todayList: Task[] = [];
    const overdueList: Task[] = [];
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

      // Check overdue status
      const isOver = isTaskOverdue(task.scheduled_at, task.is_completed);
      if (isOver) {
        overdue += 1;
        overdueList.push(task);
      }

      if (!task.scheduled_at) {
        return;
      }

      const taskLocalDate = getTaskLocalDateString(task.scheduled_at);
      const taskTimeMs = new Date(task.scheduled_at).getTime();

      // Today's tasks (scheduled strictly on today's local date)
      if (taskLocalDate === todayStr) {
        todayList.push(task);
      } else if (taskTimeMs >= startOfTomorrow && taskTimeMs <= endOfSevenDays) {
        upcomingList.push(task);
      }

      // Current week's workload
      if (taskTimeMs >= startOfWeek && taskTimeMs <= endOfWeek) {
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
      overdueTasks: overdueList,
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
    const targetStatusStr = targetStatus ? 'completed' : 'pending';

    // Optimistic update
    setTasks(prev =>
      prev.map(t =>
        t.id === task.id
          ? { ...t, is_completed: targetStatus, status: targetStatusStr }
          : t
      )
    );

    // Cancel or reschedule reminder according to completion status
    if (targetStatus) {
      await cancelTaskReminderAsync(task.id);
      setReminderTaskIds(prev => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    } else if (task.scheduled_at) {
      const res = await scheduleTaskReminderAsync({ ...task, is_completed: false });
      if (res.success) {
        setReminderTaskIds(prev => new Set(prev).add(task.id));
      }
    }

    try {
      const response = await fetch(`${TASKS_API_URL}${task.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_completed: targetStatus, status: targetStatusStr }),
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const updated = await response.json();
      setTasks(prev => prev.map(t => (t.id === task.id ? updated : t)));
    } catch (err) {
      // Revert on error
      setTasks(prev =>
        prev.map(t =>
          t.id === task.id
            ? { ...t, is_completed: !targetStatus, status: !targetStatus ? 'completed' : 'pending' }
            : t
        )
      );
      Alert.alert(
        'Update failed',
        err instanceof Error ? err.message : 'Could not update task status.'
      );
    }
  }

  async function performDelete(task: Task) {
    const deleteUrl = `${TASKS_API_URL.replace(/\/$/, '')}/${task.id}/`;
    setDeletingTaskId(task.id);

    try {
      const response = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        let errorDetail = `HTTP ${response.status}`;
        try {
          const errData = await response.json();
          errorDetail = errData?.detail || JSON.stringify(errData);
        } catch {}
        throw new Error(`Server returned status ${response.status}: ${errorDetail}`);
      }

      setTasks(prev => prev.filter(t => t.id !== task.id));
      await cancelTaskReminderAsync(task.id);
      setReminderTaskIds(prev => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Could not delete task.';
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
      Alert.alert('Delete Task', promptMsg, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => performDelete(task),
        },
      ]);
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
        const timeDisplay = formatLocalTime(res.triggerDate);
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

  // Open edit task modal
  function startEditingTask(task: Task) {
    setEditingTask(task);
    setFormTitle(task.title);
    setFormDescription(task.description || '');
    setFormPriority(task.priority || 'medium');

    if (task.scheduled_at) {
      const d = new Date(task.scheduled_at);
      setFormDate(getLocalDateString(d));
      setFormTime(formatLocalTime(d)); // exact local hour and minute (e.g. 5:48 PM)
    } else {
      setFormDate(getLocalDateString());
      setFormTime('09:00');
    }

    setFormReminderEnabled(reminderTaskIds.has(task.id));
    setFormReminderOffset(task.reminder_minutes ?? 0);
    setShowForm(true);
  }

  function startNewTask() {
    setEditingTask(null);
    setFormTitle('');
    setFormDescription('');
    setFormPriority('medium');
    setFormDate(getLocalDateString());
    setFormTime('09:00');
    setFormReminderEnabled(true);
    setFormReminderOffset(0);
    setShowForm(true);
  }

  async function handleSaveTask() {
    if (!formTitle.trim()) {
      Alert.alert('Required field', 'Please enter a task title.');
      return;
    }

    setSaving(true);

    try {
      // Build local date object with exact minute precision and convert to ISO string
      const isoTimestamp = buildScheduledIsoString(formDate, formTime);

      if (editingTask) {
        // UPDATE existing task
        const payload = {
          title: formTitle.trim(),
          description: formDescription.trim(),
          priority: formPriority,
          scheduled_at: isoTimestamp,
          reminder_minutes: formReminderEnabled ? formReminderOffset : null,
        };

        const response = await fetch(`${TASKS_API_URL}${editingTask.id}/`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(JSON.stringify(errData));
        }

        const updated: Task = await response.json();
        setTasks(prev => prev.map(t => (t.id === updated.id ? updated : t)));

        // Handle reminder update
        if (formReminderEnabled && updated.scheduled_at && !updated.is_completed) {
          const scheduleResult = await scheduleTaskReminderAsync(updated, formReminderOffset);
          if (scheduleResult.success) {
            setReminderTaskIds(prev => new Set(prev).add(updated.id));
          }
        } else {
          await cancelTaskReminderAsync(updated.id);
          setReminderTaskIds(prev => {
            const next = new Set(prev);
            next.delete(updated.id);
            return next;
          });
        }

        setShowForm(false);
        setEditingTask(null);
        Alert.alert('Task Updated', `Task updated successfully! Preserved time: ${formTime}`);
      } else {
        // CREATE new task
        const payload = {
          title: formTitle.trim(),
          description: formDescription.trim(),
          priority: formPriority,
          scheduled_at: isoTimestamp,
          is_completed: false,
          reminder_minutes: formReminderEnabled ? formReminderOffset : null,
        };

        const response = await fetch(TASKS_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
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
          const scheduleResult = await scheduleTaskReminderAsync(created, formReminderOffset);
          if (scheduleResult.success) {
            setReminderTaskIds(prev => new Set(prev).add(created.id));
            const timeDisplay = formatLocalTime(scheduleResult.triggerDate);
            reminderInfo = `\n\n🔔 Local reminder set for ${timeDisplay}!`;
          } else if (scheduleResult.reason === 'past') {
            reminderInfo = '\n\n⚠️ Reminder skipped: the chosen time has already passed.';
          } else if (scheduleResult.reason === 'permission_denied') {
            reminderInfo = '\n\n⚠️ Reminder skipped: notification permission not granted.';
          } else if (scheduleResult.reason === 'platform_unsupported') {
            reminderInfo =
              '\n\nℹ️ Note: Native notifications require a standalone APK or dev build (skipped in Expo Go).';
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
      }
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not save task.');
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
        <RefreshControl refreshing={refreshing} onRefresh={() => loadTasks(true)} />
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
            onPress={() => {
              if (showForm) {
                setShowForm(false);
                setEditingTask(null);
              } else {
                startNewTask();
              }
            }}
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

      {/* Add / Edit Task Form Card */}
      {showForm && (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>
            {editingTask ? `Edit Task #${editingTask.id}` : 'Schedule New Task'}
          </Text>

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
              <Text style={styles.inputLabel}>Time (e.g. 5:48 PM / 17:48)</Text>
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
            <Pressable style={styles.presetChip} onPress={() => setDatePreset(0, '09:00')}>
              <Text style={styles.presetChipText}>Today 9 AM</Text>
            </Pressable>
            <Pressable style={styles.presetChip} onPress={() => setDatePreset(1, '09:00')}>
              <Text style={styles.presetChipText}>Tomorrow</Text>
            </Pressable>
            <Pressable style={styles.presetChip} onPress={() => setDatePreset(3, '09:00')}>
              <Text style={styles.presetChipText}>In 3 Days</Text>
            </Pressable>
            <Pressable style={styles.presetChip} onPress={() => setDatePreset(7, '09:00')}>
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
            onPress={handleSaveTask}
          >
            <Text style={styles.saveButtonText}>
              {saving
                ? 'Saving Task...'
                : editingTask
                  ? 'Update Task'
                  : 'Save & Schedule Task'}
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

      {/* Overdue Section in Today's View if any overdue tasks exist */}
      {activeTab === 'today' && overdueTasks.length > 0 && (
        <View style={styles.overdueAlertBanner}>
          <Text style={styles.overdueAlertTitle}>
            ⚠️ {overdueTasks.length} Overdue Task{overdueTasks.length === 1 ? '' : 's'}
          </Text>
          <Text style={styles.overdueAlertSubtitle}>
            These tasks have passed their scheduled time and require immediate attention.
          </Text>
        </View>
      )}

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
            const { label: dateLabel, isOverdue } = formatScheduledDisplay(task.scheduled_at);
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
                    {task.is_completed && <Text style={styles.checkboxCheckmark}>✓</Text>}
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
                          <Text style={styles.reminderTextActive}>🔔 Alert Active</Text>
                        </Pressable>
                      )}

                      {!task.is_completed && !hasReminder && !isOverdue && (
                        <Pressable
                          style={styles.reminderBadgeInactive}
                          onPress={() => handleToggleReminder(task)}
                        >
                          <Text style={styles.reminderTextInactive}>+ 🔔 Set Alert</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>

                  {/* Actions Column: Edit & Delete */}
                  <View style={styles.actionColumn}>
                    <Pressable
                      style={styles.editButton}
                      onPress={() => startEditingTask(task)}
                    >
                      <Text style={styles.editButtonText}>Edit</Text>
                    </Pressable>

                    <Pressable
                      style={[
                        styles.deleteButton,
                        deletingTaskId === task.id && { opacity: 0.5 },
                      ]}
                      disabled={deletingTaskId === task.id}
                      onPress={() => handleDeleteTask(task)}
                      accessibilityLabel={`Delete ${task.title}`}
                    >
                      <Text style={styles.deleteButtonText}>✕</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    backgroundColor: '#172033',
    paddingTop: Platform.OS === 'ios' ? 52 : 36,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logo: {
    width: 38,
    height: 38,
    borderRadius: 9,
    backgroundColor: '#4263EB',
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 22,
    textAlign: 'center',
    lineHeight: 38,
  },
  brand: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 12,
  },
  welcome: {
    padding: 16,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E293B',
  },
  description: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  primaryButton: {
    backgroundColor: '#4263EB',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  progressCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressTitleCol: {
    flex: 1,
  },
  progressSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  progressSectionSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  overallPercentBadge: {
    backgroundColor: '#EEF2FF',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  overallPercentBadgeComplete: {
    backgroundColor: '#D1FAE5',
  },
  overallPercentText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#4263EB',
  },
  overallPercentTextComplete: {
    color: '#059669',
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressBreakdownContainer: {
    gap: 8,
    marginBottom: 10,
  },
  progressRow: {},
  progressRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  progressRowTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  progressRowCount: {
    fontSize: 11,
    color: '#64748B',
  },
  miniProgressBarTrack: {
    height: 4,
    backgroundColor: '#F1F5F9',
    borderRadius: 2,
    overflow: 'hidden',
  },
  miniProgressBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  statusPillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  statusPillPending: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 6,
    paddingVertical: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statusPillPendingLabel: {
    fontSize: 10,
    color: '#64748B',
  },
  statusPillPendingValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 1,
  },
  statusPillOverdue: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 6,
    paddingVertical: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statusPillOverdueAlert: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
  },
  statusPillOverdueLabel: {
    fontSize: 10,
    color: '#64748B',
  },
  statusPillOverdueLabelAlert: {
    color: '#DC2626',
    fontWeight: '700',
  },
  statusPillOverdueValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 1,
  },
  statusPillOverdueValueAlert: {
    color: '#DC2626',
  },
  statusPillCompleted: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 6,
    paddingVertical: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statusPillCompletedLabel: {
    fontSize: 10,
    color: '#64748B',
  },
  statusPillCompletedValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#059669',
    marginTop: 1,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    minWidth: '22%',
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 11,
    color: '#64748B',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 2,
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  formTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 10,
  },
  inputGroup: {
    marginBottom: 10,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 6,
    paddingVertical: 7,
    paddingHorizontal: 10,
    fontSize: 13,
    color: '#1E293B',
  },
  multilineInput: {
    minHeight: 56,
    textAlignVertical: 'top',
  },
  prioritySelector: {
    flexDirection: 'row',
    gap: 6,
  },
  priorityOption: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  priorityOptionSelected: {
    borderColor: '#4263EB',
  },
  priorityOptionText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  presetRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
  },
  presetChip: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    paddingVertical: 5,
    alignItems: 'center',
    borderRadius: 6,
  },
  presetChipText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '500',
  },
  reminderCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  reminderToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  switchTrack: {
    width: 32,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#CBD5E1',
    padding: 2,
  },
  switchTrackActive: {
    backgroundColor: '#4263EB',
  },
  switchThumb: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
  },
  switchThumbActive: {
    transform: [{ translateX: 14 }],
  },
  reminderToggleTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E293B',
  },
  reminderToggleSubtitle: {
    fontSize: 10,
    color: '#64748B',
  },
  offsetSection: {
    marginTop: 8,
  },
  offsetHeading: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 4,
  },
  offsetOptionsGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  offsetChip: {
    flex: 1,
    backgroundColor: '#E2E8F0',
    paddingVertical: 4,
    alignItems: 'center',
    borderRadius: 4,
  },
  offsetChipSelected: {
    backgroundColor: '#4263EB',
  },
  offsetChipText: {
    fontSize: 10,
    color: '#475569',
  },
  offsetChipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  saveButton: {
    backgroundColor: '#4263EB',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  tabsContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: '#E2E8F0',
    borderRadius: 8,
    padding: 2,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  tabButtonActive: {
    backgroundColor: '#FFFFFF',
  },
  tabButtonText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  tabButtonTextActive: {
    color: '#1E293B',
    fontWeight: '700',
  },
  overdueAlertBanner: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 8,
    padding: 10,
  },
  overdueAlertTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#DC2626',
  },
  overdueAlertSubtitle: {
    fontSize: 11,
    color: '#B91C1C',
    marginTop: 2,
  },
  taskList: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 40,
  },
  taskCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  taskCardCompleted: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
    opacity: 0.85,
  },
  taskCardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#94A3B8',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  checkboxCompleted: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  checkboxCheckmark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  taskContent: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
  },
  taskTitleCompleted: {
    textDecorationLine: 'line-through',
    color: '#64748B',
  },
  taskDescription: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  taskDescriptionCompleted: {
    textDecorationLine: 'line-through',
    color: '#94A3B8',
  },
  taskMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeHigh: { backgroundColor: '#FEE2E2' },
  badgeMedium: { backgroundColor: '#FEF3C7' },
  badgeLow: { backgroundColor: '#E0E7FF' },
  badgeText: { fontSize: 10, fontWeight: '700' },
  badgeTextHigh: { color: '#B91C1C' },
  badgeTextMedium: { color: '#92400E' },
  badgeTextLow: { color: '#3730A3' },
  dateText: { fontSize: 11, color: '#64748B' },
  dateTextOverdue: { color: '#DC2626', fontWeight: '700' },
  dateTextCompleted: { color: '#059669' },
  reminderBadgeActive: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  reminderTextActive: { fontSize: 10, color: '#4263EB', fontWeight: '600' },
  reminderBadgeInactive: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  reminderTextInactive: { fontSize: 10, color: '#64748B' },
  actionColumn: {
    alignItems: 'flex-end',
    gap: 6,
  },
  editButton: {
    backgroundColor: '#EEF2FF',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  editButtonText: {
    fontSize: 11,
    color: '#4263EB',
    fontWeight: '600',
  },
  deleteButton: {
    padding: 4,
  },
  deleteButtonText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  message: {
    alignItems: 'center',
    padding: 30,
  },
  messageText: {
    color: '#64748B',
    marginTop: 8,
  },
  errorCard: {
    backgroundColor: '#FEF2F2',
    margin: 16,
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#DC2626',
    marginBottom: 4,
  },
  errorText: {
    fontSize: 12,
    color: '#B91C1C',
    marginBottom: 8,
  },
  retryButton: {
    backgroundColor: '#DC2626',
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
});
