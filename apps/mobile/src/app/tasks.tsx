import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  RefreshControl,
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
import {
  subscribeToTaskChanges,
  notifyTaskChange,
  shouldFetchTasks,
  markTasksFetched,
  setFetchInProgress,
} from '@/services/task-sync';
import { syncWidgetDataAsync } from '@/services/widget-data';
import {
  fetchDailyProgress,
  fetchDailyProgressList,
  saveDailyProgress,
  DailyProgress,
} from '@/services/daily-progress';
import {
  getLocalDateString,
  getTaskLocalDateString,
  formatLocalTime,
  parseTimeString,
  parseDateString,
  buildScheduledIsoString,
  formatScheduledDisplay,
  isTaskOverdue,
  sortTasksByPriorityAndTime,
  getDateRangeDays,
} from '@/utils/timezone';

import { Task, TaskPriority, TaskStatus, UnifiedViewTab } from '@/components/tasks/types';
import { TaskCard } from '@/components/tasks/TaskCard';
import { TaskModal, TaskSavePayload } from '@/components/tasks/TaskModal';
import { TaskProgressCard } from '@/components/tasks/TaskProgressCard';
import { CalendarSection } from '@/components/tasks/CalendarSection';

// Re-export timezone helpers and task types for backward compatibility
export {
  getLocalDateString,
  parseTimeString,
  parseDateString,
  buildScheduledIsoString,
  formatScheduledDisplay,
  sortTasksByPriorityAndTime,
};
export type { Task, TaskPriority, TaskStatus };

export function isTaskDone(t: Task): boolean {
  return Boolean(t.is_completed || t.status === 'completed');
}

export default function TasksScreen() {
  const params = useLocalSearchParams<{ view?: string }>();
  const [activeTab, setActiveTab] = useState<UnifiedViewTab>(
    params.view === 'calendar' ? 'calendar' : 'today'
  );

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Daily Progress Map & Current Selected Date Progress
  const [dailyProgressMap, setDailyProgressMap] = useState<Record<string, DailyProgress>>({});
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateString());
  const [currentProgress, setCurrentProgress] = useState<DailyProgress>({
    date: getLocalDateString(),
    description: '',
    achievements: '',
    blockers: '',
    next_steps: '',
    notes: '',
  });
  const [savingProgress, setSavingProgress] = useState(false);
  const [progressSaveSuccess, setProgressSaveSuccess] = useState(false);

  // Calendar Date Range Selection State
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);

  // Active reminder IDs tracked in OS notification queue
  const [reminderTaskIds, setReminderTaskIds] = useState<Set<number>>(new Set());

  // Shared Add / Edit Task Modal State
  const [taskModalVisible, setTaskModalVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [modalInitialDate, setModalInitialDate] = useState(() => getLocalDateString());
  const [savingTask, setSavingTask] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<number | null>(null);

  // Switch to calendar if query param specified
  useEffect(() => {
    if (params.view === 'calendar') {
      setActiveTab('calendar');
    }
  }, [params.view]);

  // Load Tasks and Daily Progress
  const loadData = useCallback(async (pullToRefresh = false, force = false) => {
    if (!force && !pullToRefresh && !shouldFetchTasks(1500)) {
      return;
    }
    setFetchInProgress(true);
    if (pullToRefresh) {
      setRefreshing(true);
    } else if (tasks.length === 0) {
      setLoading(true);
    }

    setError('');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      // 1. Fetch tasks from backend
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
      markTasksFetched();

      // 2. Load daily progress entries
      const progressList = await fetchDailyProgressList();
      const pMap: Record<string, DailyProgress> = {};
      for (const item of progressList) {
        pMap[item.date] = item;
      }
      setDailyProgressMap(pMap);

      // 3. Sync active scheduled notifications from local device
      const activeReminders = await getActiveReminderTaskIdsAsync();
      setReminderTaskIds(activeReminders);

      // 4. Restore alarms if needed for pending future tasks
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
      setFetchInProgress(false);
      setLoading(false);
      setRefreshing(false);
    }
  }, [tasks.length]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Immediately reload when tasks are modified elsewhere
  useEffect(() => {
    const unsubscribe = subscribeToTaskChanges(() => {
      loadData(false, true);
    });
    return unsubscribe;
  }, [loadData]);

  // Refresh whenever screen gains focus
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Sync widget snapshot on tasks update
  useEffect(() => {
    if (tasks.length > 0) {
      syncWidgetDataAsync(tasks);
    }
  }, [tasks]);

  // Load daily progress for selected date
  useEffect(() => {
    async function loadSelectedProgress() {
      if (dailyProgressMap[selectedDate]) {
        setCurrentProgress(dailyProgressMap[selectedDate]);
      } else {
        const fetched = await fetchDailyProgress(selectedDate);
        if (fetched && fetched.description !== undefined) {
          setCurrentProgress(fetched);
          setDailyProgressMap(prev => ({ ...prev, [selectedDate]: fetched }));
        } else {
          setCurrentProgress({
            date: selectedDate,
            description: '',
            achievements: '',
            blockers: '',
            next_steps: '',
            notes: '',
          });
        }
      }
      setProgressSaveSuccess(false);
    }
    loadSelectedProgress();
  }, [selectedDate, dailyProgressMap]);

  // Group tasks by their device-local calendar date
  const tasksByLocalDate = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const task of tasks) {
      const localDate = getTaskLocalDateString(task.scheduled_at);
      if (localDate) {
        if (!map[localDate]) map[localDate] = [];
        map[localDate].push(task);
      }
    }
    for (const dateKey in map) {
      map[dateKey] = sortTasksByPriorityAndTime(map[dateKey]);
    }
    return map;
  }, [tasks]);

  // Computed metrics and view lists
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

    // Monday to Sunday of current week
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
      const isDone = isTaskDone(task);
      if (isDone) {
        completed += 1;
      } else {
        pending += 1;
      }

      // Check overdue status
      const isOver = isTaskOverdue(task.scheduled_at, isDone);
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
    const todayCompletedCount = todayList.filter(isTaskDone).length;
    const todayPercentage =
      todayTotalCount > 0 ? Math.round((todayCompletedCount / todayTotalCount) * 100) : 0;

    const weekTotalCount = weekList.length;
    const weekCompletedCount = weekList.filter(isTaskDone).length;
    const weekPercentage =
      weekTotalCount > 0 ? Math.round((weekCompletedCount / weekTotalCount) * 100) : 0;

    return {
      todayTasks: sortTasksByPriorityAndTime(todayList),
      overdueTasks: sortTasksByPriorityAndTime(overdueList),
      upcomingTasks: sortTasksByPriorityAndTime(upcomingList),
      allTasks: sortTasksByPriorityAndTime(tasks),
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

  // Tasks to display in standard list views
  const displayedTasks = useMemo(() => {
    if (activeTab === 'today') return todayTasks;
    if (activeTab === 'upcoming') return upcomingTasks;
    if (activeTab === 'all') return allTasks;
    return [];
  }, [activeTab, todayTasks, upcomingTasks, allTasks]);

  // Active range days
  const activeRangeDays = useMemo(() => {
    if (rangeStart && rangeEnd) {
      return getDateRangeDays(rangeStart, rangeEnd);
    }
    if (rangeStart) {
      return [rangeStart];
    }
    return [];
  }, [rangeStart, rangeEnd]);

  // Action: Toggle Task Completion
  async function handleToggleTask(task: Task) {
    const targetStatus = !task.is_completed;
    const targetStatusStr: TaskStatus = targetStatus ? 'completed' : 'pending';

    // Optimistic update
    setTasks(prev =>
      prev.map(t =>
        t.id === task.id
          ? { ...t, is_completed: targetStatus, status: targetStatusStr }
          : t
      )
    );

    // Cancel or reschedule reminder
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
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ is_completed: targetStatus, status: targetStatusStr }),
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const updated = await response.json();
      setTasks(prev => prev.map(t => (t.id === task.id ? updated : t)));
      notifyTaskChange();
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

  // Action: Delete Task
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
      notifyTaskChange();
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

  // Action: Toggle Reminder
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

  // Action: Open Shared Task Modal
  function openCreateTaskModal(targetDate?: string) {
    setEditingTask(null);
    setModalInitialDate(targetDate || (activeTab === 'calendar' ? selectedDate : getLocalDateString()));
    setTaskModalVisible(true);
  }

  function openEditTaskModal(task: Task) {
    setEditingTask(task);
    setModalInitialDate(
      task.scheduled_at ? getLocalDateString(new Date(task.scheduled_at)) : getLocalDateString()
    );
    setTaskModalVisible(true);
  }

  // Action: Save Task (Shared Create / Update)
  async function handleSaveTask(payload: TaskSavePayload) {
    setSavingTask(true);
    try {
      const scheduledIso = buildScheduledIsoString(payload.date, payload.startTime);
      const endIso = payload.endTime
        ? buildScheduledIsoString(payload.date, payload.endTime)
        : null;

      const journalNote = (payload.journalEntry || payload.notes || payload.description || '').trim();

      if (editingTask) {
        // UPDATE existing task
        const bodyPayload = {
          title: payload.title,
          description: journalNote,
          priority: payload.priority,
          status: payload.status,
          is_completed: payload.status === 'completed',
          scheduled_at: scheduledIso,
          end_at: endIso,
          notes: journalNote,
          reminder_minutes: payload.reminderEnabled ? payload.reminderOffset : null,
        };

        const res = await fetch(`${TASKS_API_URL}${editingTask.id}/`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(bodyPayload),
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(JSON.stringify(errData));
        }

        const updated: Task = await res.json();
        setTasks(prev => prev.map(t => (t.id === updated.id ? updated : t)));
        notifyTaskChange();

        // Associate with DailyProgress journal
        if (journalNote && payload.date) {
          try {
            const existingDp = dailyProgressMap[payload.date] || (await fetchDailyProgress(payload.date));
            let mergedDescription = journalNote;
            if (existingDp && existingDp.description && existingDp.description.trim()) {
              if (!existingDp.description.includes(journalNote)) {
                mergedDescription = `${existingDp.description.trim()}\n• [${updated.title}]: ${journalNote}`;
              } else {
                mergedDescription = existingDp.description;
              }
            }
            const savedDp = await saveDailyProgress({
              date: payload.date,
              description: mergedDescription,
              linked_task: updated.id,
            });
            setDailyProgressMap(prev => ({ ...prev, [payload.date]: savedDp }));
          } catch (dpErr) {
            console.warn('[handleSaveTask] Daily progress sync error:', dpErr);
          }
        }

        // Update reminder
        if (payload.reminderEnabled && updated.scheduled_at && !updated.is_completed) {
          const sRes = await scheduleTaskReminderAsync(updated, payload.reminderOffset);
          if (sRes.success) {
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

        setTaskModalVisible(false);
        setEditingTask(null);
        Alert.alert('Task Updated', `Task updated successfully! Preserved time: ${payload.startTime}`);
      } else {
        // CREATE new task(s)
        const targetDates =
          payload.scheduleAcrossRange && activeRangeDays.length > 1
            ? activeRangeDays
            : [payload.date];

        const createdItems: Task[] = [];

        for (const dateItem of targetDates) {
          const itemScheduledIso = buildScheduledIsoString(dateItem, payload.startTime);
          const itemEndIso = payload.endTime
            ? buildScheduledIsoString(dateItem, payload.endTime)
            : null;

          const bodyPayload = {
            title: payload.title,
            description: journalNote,
            priority: payload.priority,
            status: payload.status,
            is_completed: payload.status === 'completed',
            scheduled_at: itemScheduledIso,
            end_at: itemEndIso,
            notes: journalNote,
            reminder_minutes: payload.reminderEnabled ? payload.reminderOffset : null,
          };

          const res = await fetch(TASKS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(bodyPayload),
          });

          if (!res.ok) {
            const errData = await res.json();
            throw new Error(JSON.stringify(errData));
          }

          const created: Task = await res.json();
          createdItems.push(created);

          // Associate with DailyProgress journal for this date
          if (journalNote) {
            try {
              const existingDp = dailyProgressMap[dateItem] || (await fetchDailyProgress(dateItem));
              let mergedDescription = journalNote;
              if (existingDp && existingDp.description && existingDp.description.trim()) {
                if (!existingDp.description.includes(journalNote)) {
                  mergedDescription = `${existingDp.description.trim()}\n• [${created.title}]: ${journalNote}`;
                } else {
                  mergedDescription = existingDp.description;
                }
              }
              const savedDp = await saveDailyProgress({
                date: dateItem,
                description: mergedDescription,
                linked_task: created.id,
              });
              setDailyProgressMap(prev => ({ ...prev, [dateItem]: savedDp }));
            } catch (dpErr) {
              console.warn('[handleSaveTask] Daily progress sync error:', dpErr);
            }
          }

          if (payload.reminderEnabled && created.scheduled_at && !created.is_completed) {
            const sRes = await scheduleTaskReminderAsync(created, payload.reminderOffset);
            if (sRes.success) {
              setReminderTaskIds(prev => new Set(prev).add(created.id));
            }
          }
        }

        setTasks(prev => [...createdItems, ...prev]);
        notifyTaskChange();
        setTaskModalVisible(false);

        Alert.alert(
          'Task Created',
          createdItems.length > 1
            ? `Scheduled across ${createdItems.length} selected dates successfully!`
            : 'Task added successfully!'
        );
      }
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not save task.');
    } finally {
      setSavingTask(false);
    }
  }

  // Action: Save Daily Progress
  async function handleSaveDailyProgress() {
    setSavingProgress(true);
    setProgressSaveSuccess(false);

    try {
      const saved = await saveDailyProgress({
        ...currentProgress,
        date: selectedDate,
      });

      setCurrentProgress(saved);
      setDailyProgressMap(prev => ({ ...prev, [selectedDate]: saved }));
      setProgressSaveSuccess(true);
      setTimeout(() => setProgressSaveSuccess(false), 3000);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not save progress.');
    } finally {
      setSavingProgress(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} />
      }
    >
      <StatusBar barStyle="light-content" backgroundColor="#172033" />

      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerBrandRow}>
          <Text style={styles.logo}>S</Text>
          <View>
            <Text style={styles.brand}>StockFlow</Text>
            <Text style={styles.subtitle}>Task & Calendar Management</Text>
          </View>
        </View>

        <Pressable
          style={styles.headerAddBtn}
          onPress={() => openCreateTaskModal()}
          accessibilityLabel="Add New Task"
        >
          <Text style={styles.headerAddBtnText}>+ New Task</Text>
        </Pressable>
      </View>

      {/* Welcome / Summary Row */}
      <View style={styles.welcome}>
        <View style={styles.titleRow}>
          <View>
            <Text style={styles.greeting}>Task Center</Text>
            <Text style={styles.description}>
              {pendingCount === 0
                ? 'All tasks completed! Great work.'
                : `${pendingCount} pending task${pendingCount === 1 ? '' : 's'} across workflows.`}
            </Text>
          </View>
        </View>
      </View>

      {/* Task Progress Dashboard Section */}
      <TaskProgressCard
        totalTasks={totalTasks}
        totalCompleted={totalCompleted}
        overallPercent={overallPercent}
        todayTotal={todayTotal}
        todayCompleted={todayCompleted}
        todayPercent={todayPercent}
        weekTotal={weekTotal}
        weekCompleted={weekCompleted}
        weekPercent={weekPercent}
        pendingCount={pendingCount}
        overdueCount={overdueCount}
        dueTodayIncomplete={todayTasks.filter(t => !isTaskDone(t)).length}
        dueUpcomingIncomplete={upcomingTasks.filter(t => !isTaskDone(t)).length}
      />

      {/* Segmented Unified View Switcher Bar */}
      <View style={styles.tabsContainer}>
        <Pressable
          style={[styles.tabButton, activeTab === 'today' && styles.tabButtonActive]}
          onPress={() => setActiveTab('today')}
          accessibilityLabel="View Today's Tasks"
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
          style={[styles.tabButton, activeTab === 'upcoming' && styles.tabButtonActive]}
          onPress={() => setActiveTab('upcoming')}
          accessibilityLabel="View Upcoming 7 Days Tasks"
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
          accessibilityLabel="View All Tasks"
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

        <Pressable
          style={[styles.tabButton, activeTab === 'calendar' && styles.tabButtonActive]}
          onPress={() => setActiveTab('calendar')}
          accessibilityLabel="View Calendar & Planner"
        >
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'calendar' && styles.tabButtonTextActive,
            ]}
          >
            Calendar ({tasks.length})
          </Text>
        </Pressable>
      </View>

      {/* Overdue Section in Today's View */}
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

      {/* Loading & Error States */}
      {loading ? (
        <View style={styles.message}>
          <ActivityIndicator size="large" color="#4263EB" />
          <Text style={styles.messageText}>Loading tasks from StockFlow...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Connection Failed</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => loadData()}>
            <Text style={styles.retryButtonText}>Tap here to retry</Text>
          </Pressable>
        </View>
      ) : activeTab === 'calendar' ? (
        /* Unified Calendar View */
        <CalendarSection
          tasks={tasks}
          tasksByLocalDate={tasksByLocalDate}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          onSetRangeStart={setRangeStart}
          onSetRangeEnd={setRangeEnd}
          dailyProgressMap={dailyProgressMap}
          currentProgress={currentProgress}
          onChangeProgress={setCurrentProgress}
          savingProgress={savingProgress}
          progressSaveSuccess={progressSaveSuccess}
          onSaveProgress={handleSaveDailyProgress}
          reminderTaskIds={reminderTaskIds}
          deletingTaskId={deletingTaskId}
          onToggleComplete={handleToggleTask}
          onToggleReminder={handleToggleReminder}
          onEditTask={openEditTaskModal}
          onDeleteTask={handleDeleteTask}
          onOpenCreateTask={openCreateTaskModal}
          onOpenCreateAcrossRange={openCreateTaskModal}
        />
      ) : (
        /* Standard Tasks List View: Today, Upcoming, or All */
        <View style={styles.taskList}>
          {displayedTasks.length === 0 ? (
            <View style={styles.emptyViewCard}>
              <Text style={styles.emptyViewEmoji}>
                {activeTab === 'today' ? '☀️' : activeTab === 'upcoming' ? '🗓️' : '📋'}
              </Text>
              <Text style={styles.emptyViewTitle}>
                {activeTab === 'today'
                  ? 'No tasks scheduled for today'
                  : activeTab === 'upcoming'
                    ? 'No upcoming tasks in the next 7 days'
                    : 'No tasks found in StockFlow'}
              </Text>
              <Text style={styles.emptyViewSubtitle}>
                Tap "+ New Task" above to add an inventory audit, delivery check, or stock count.
              </Text>
              <Pressable style={styles.emptyAddBtn} onPress={() => openCreateTaskModal()}>
                <Text style={styles.emptyAddBtnText}>+ Add Task</Text>
              </Pressable>
            </View>
          ) : (
            displayedTasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                isReminderActive={reminderTaskIds.has(task.id)}
                isDeleting={deletingTaskId === task.id}
                onToggleComplete={handleToggleTask}
                onToggleReminder={handleToggleReminder}
                onEdit={openEditTaskModal}
                onDelete={handleDeleteTask}
              />
            ))
          )}
        </View>
      )}

      {/* Shared Add / Edit Task Modal */}
      <TaskModal
        visible={taskModalVisible}
        editingTask={editingTask}
        initialDate={modalInitialDate}
        activeRangeDays={activeRangeDays}
        isReminderSet={editingTask ? reminderTaskIds.has(editingTask.id) : true}
        saving={savingTask}
        onClose={() => {
          setTaskModalVisible(false);
          setEditingTask(null);
        }}
        onSave={handleSaveTask}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  screenContent: {
    paddingBottom: 85, // Android bottom tab bar safe padding
  },
  header: {
    backgroundColor: '#172033',
    paddingTop: Platform.OS === 'ios' ? 52 : 36,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBrandRow: {
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
  headerAddBtn: {
    backgroundColor: '#4263EB',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  headerAddBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
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
    fontSize: 11,
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
  },
  emptyViewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginVertical: 12,
  },
  emptyViewEmoji: {
    fontSize: 36,
    marginBottom: 8,
  },
  emptyViewTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  emptyViewSubtitle: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 4,
    maxWidth: 280,
  },
  emptyAddBtn: {
    backgroundColor: '#4263EB',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 6,
    marginTop: 12,
  },
  emptyAddBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
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
