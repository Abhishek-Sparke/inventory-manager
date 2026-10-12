import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  Modal,
} from 'react-native';

import { TASKS_API_URL } from '@/constants/api';
import {
  fetchDailyProgress,
  fetchDailyProgressList,
  saveDailyProgress,
  DailyProgress,
} from '@/services/daily-progress';
import {
  scheduleTaskReminderAsync,
  cancelTaskReminderAsync,
  getActiveReminderTaskIdsAsync,
} from '@/services/notifications';
import {
  getLocalDateString,
  getTaskLocalDateString,
  formatLocalTime,
  parseTimeString,
  parseDateString,
  buildScheduledIsoString,
  formatScheduledDisplay,
  isTaskOverdue,
  getEightDayWindow,
  getDateRangeDays,
  formatFriendlyDate,
} from '@/utils/timezone';

export type TaskPriority = 'low' | 'medium' | 'high';
export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export type TaskItem = {
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

type PlannerTab = 'day' | 'range' | 'tracker';

export default function PlannerScreen() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<PlannerTab>('day');

  // Calendar month view state
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth()); // 0-indexed

  // Selection states
  const todayStr = useMemo(() => getLocalDateString(), []);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);

  // Daily Progress states
  const [dailyProgressMap, setDailyProgressMap] = useState<Record<string, DailyProgress>>({});
  const [currentProgress, setCurrentProgress] = useState<DailyProgress>({
    date: todayStr,
    description: '',
    achievements: '',
    blockers: '',
    next_steps: '',
    notes: '',
  });
  const [savingProgress, setSavingProgress] = useState(false);
  const [progressSaveSuccess, setProgressSaveSuccess] = useState(false);

  // Reminders state
  const [reminderTaskIds, setReminderTaskIds] = useState<Set<number>>(new Set());

  // Modal / Form state for Event (Add / Edit)
  const [eventModalVisible, setEventModalVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDate, setFormDate] = useState(todayStr);
  const [formStartTime, setFormStartTime] = useState('09:00');
  const [formEndTime, setFormEndTime] = useState('10:00');
  const [formHasEndTime, setFormHasEndTime] = useState(false);
  const [formPriority, setFormPriority] = useState<TaskPriority>('medium');
  const [formStatus, setFormStatus] = useState<TaskStatus>('pending');
  const [formNotes, setFormNotes] = useState('');
  const [formReminderEnabled, setFormReminderEnabled] = useState(false);
  const [formReminderOffset, setFormReminderOffset] = useState<number>(0);
  const [scheduleAcrossRange, setScheduleAcrossRange] = useState(false);
  const [savingEvent, setSavingEvent] = useState(false);

  // Load all tasks and daily progress list
  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      // 1. Fetch tasks
      const res = await fetch(TASKS_API_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        const list: TaskItem[] = Array.isArray(data)
          ? data
          : Array.isArray(data.results)
            ? data.results
            : [];
        setTasks(list);
      }

      // 2. Fetch daily progress list
      const progressList = await fetchDailyProgressList();
      const pMap: Record<string, DailyProgress> = {};
      for (const item of progressList) {
        pMap[item.date] = item;
      }
      setDailyProgressMap(pMap);

      // 3. Load active reminders
      const activeReminders = await getActiveReminderTaskIdsAsync();
      setReminderTaskIds(activeReminders);
    } catch (err) {
      console.error('[Planner] Load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load progress for selected date
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
    const map: Record<string, TaskItem[]> = {};
    for (const task of tasks) {
      const localDate = getTaskLocalDateString(task.scheduled_at);
      if (localDate) {
        if (!map[localDate]) map[localDate] = [];
        map[localDate].push(task);
      }
    }
    return map;
  }, [tasks]);

  // Tasks for the currently selected date
  const selectedDateTasks = useMemo(() => {
    return tasksByLocalDate[selectedDate] || [];
  }, [tasksByLocalDate, selectedDate]);

  // Selected date metrics
  const selectedDayMetrics = useMemo(() => {
    const dayTasks = selectedDateTasks;
    const total = dayTasks.length;
    const completed = dayTasks.filter(t => t.is_completed || t.status === 'completed').length;
    const pending = total - completed;
    const percent = total > 0 ? Math.round((completed / total) * 100) : null;
    return { total, completed, pending, percent };
  }, [selectedDateTasks]);

  // Selected date range array
  const activeRangeDays = useMemo(() => {
    if (rangeStart && rangeEnd) {
      return getDateRangeDays(rangeStart, rangeEnd);
    }
    if (rangeStart) {
      return [rangeStart];
    }
    return [];
  }, [rangeStart, rangeEnd]);

  // 8-Day tracker window starting from today
  const eightDayTracker = useMemo(() => {
    const windowDays = getEightDayWindow(new Date());
    return windowDays.map(d => {
      const dateStr = getLocalDateString(d);
      const dayTasks = tasksByLocalDate[dateStr] || [];
      const total = dayTasks.length;
      const completed = dayTasks.filter(t => t.is_completed || t.status === 'completed').length;
      const pending = total - completed;
      const percent = total > 0 ? Math.round((completed / total) * 100) : null;
      const progressEntry = dailyProgressMap[dateStr];
      const nextUpcoming = dayTasks.find(t => !t.is_completed);

      return {
        dateStr,
        dayName: d.toLocaleDateString([], { weekday: 'short' }),
        displayDate: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
        isToday: dateStr === todayStr,
        total,
        completed,
        pending,
        percent,
        progressDescription: progressEntry?.description || '',
        nextUpcoming,
      };
    });
  }, [tasksByLocalDate, dailyProgressMap, todayStr]);

  // Month navigation
  function prevMonth() {
    if (calendarMonth === 0) {
      setCalendarMonth(11);
      setCalendarYear(calendarYear - 1);
    } else {
      setCalendarMonth(calendarMonth - 1);
    }
  }

  function nextMonth() {
    if (calendarMonth === 11) {
      setCalendarMonth(0);
      setCalendarYear(calendarYear + 1);
    } else {
      setCalendarMonth(calendarMonth + 1);
    }
  }

  // Handle calendar day tap
  function handleDayTap(dateStr: string) {
    setSelectedDate(dateStr);

    if (!rangeStart || (rangeStart && rangeEnd)) {
      // First tap: start new range selection
      setRangeStart(dateStr);
      setRangeEnd(null);
    } else if (rangeStart && !rangeEnd) {
      // Second tap: set end range
      if (dateStr < rangeStart) {
        setRangeEnd(rangeStart);
        setRangeStart(dateStr);
      } else {
        setRangeEnd(dateStr);
      }
    }
  }

  function clearRangeSelection() {
    setRangeStart(null);
    setRangeEnd(null);
  }

  // Open modal for new event
  function openCreateEventModal(targetDate: string = selectedDate) {
    setEditingTask(null);
    setFormTitle('');
    setFormDescription('');
    setFormDate(targetDate);
    setFormStartTime('09:00');
    setFormEndTime('10:00');
    setFormHasEndTime(false);
    setFormPriority('medium');
    setFormStatus('pending');
    setFormNotes('');
    setFormReminderEnabled(false);
    setFormReminderOffset(0);
    setScheduleAcrossRange(false);
    setEventModalVisible(true);
  }

  // Open modal to edit existing event/task
  function openEditEventModal(task: TaskItem) {
    setEditingTask(task);
    setFormTitle(task.title);
    setFormDescription(task.description || '');

    // Extract local date and time from scheduled_at
    if (task.scheduled_at) {
      const d = new Date(task.scheduled_at);
      setFormDate(getLocalDateString(d));
      setFormStartTime(formatLocalTime(d));
    } else {
      setFormDate(selectedDate);
      setFormStartTime('09:00');
    }

    if (task.end_at) {
      const endD = new Date(task.end_at);
      setFormEndTime(formatLocalTime(endD));
      setFormHasEndTime(true);
    } else {
      setFormEndTime('10:00');
      setFormHasEndTime(false);
    }

    setFormPriority(task.priority || 'medium');
    setFormStatus(task.status || (task.is_completed ? 'completed' : 'pending'));
    setFormNotes(task.notes || '');
    setFormReminderEnabled(reminderTaskIds.has(task.id));
    setFormReminderOffset(task.reminder_minutes ?? 0);
    setScheduleAcrossRange(false);
    setEventModalVisible(true);
  }

  // Save Event (Create or Update)
  async function handleSaveEvent() {
    if (!formTitle.trim()) {
      Alert.alert('Required', 'Please enter an event or task title.');
      return;
    }

    setSavingEvent(true);
    try {
      const scheduledIso = buildScheduledIsoString(formDate, formStartTime);
      const endIso = formHasEndTime
        ? buildScheduledIsoString(formDate, formEndTime)
        : null;

      if (editingTask) {
        // UPDATE existing task
        const payload: Partial<TaskItem> = {
          title: formTitle.trim(),
          description: formDescription.trim(),
          scheduled_at: scheduledIso,
          end_at: endIso,
          priority: formPriority,
          status: formStatus,
          is_completed: formStatus === 'completed',
          notes: formNotes.trim(),
          reminder_minutes: formReminderEnabled ? formReminderOffset : null,
        };

        const res = await fetch(`${TASKS_API_URL}${editingTask.id}/`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(JSON.stringify(errData));
        }

        const updated: TaskItem = await res.json();
        setTasks(prev => prev.map(t => (t.id === updated.id ? updated : t)));

        // Handle reminder update
        if (formReminderEnabled && updated.scheduled_at && !updated.is_completed) {
          const sRes = await scheduleTaskReminderAsync(updated, formReminderOffset);
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

        Alert.alert('Success', 'Event updated successfully!');
      } else {
        // CREATE new event / task
        // If user explicitly checked multi-day scheduling across range
        const targetDates =
          scheduleAcrossRange && activeRangeDays.length > 1
            ? activeRangeDays
            : [formDate];

        const createdItems: TaskItem[] = [];

        for (const dateItem of targetDates) {
          const itemScheduledIso = buildScheduledIsoString(dateItem, formStartTime);
          const itemEndIso = formHasEndTime
            ? buildScheduledIsoString(dateItem, formEndTime)
            : null;

          const payload = {
            title: formTitle.trim(),
            description: formDescription.trim(),
            scheduled_at: itemScheduledIso,
            end_at: itemEndIso,
            priority: formPriority,
            status: formStatus,
            is_completed: formStatus === 'completed',
            notes: formNotes.trim(),
            reminder_minutes: formReminderEnabled ? formReminderOffset : null,
          };

          const res = await fetch(TASKS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
          });

          if (res.ok) {
            const created: TaskItem = await res.json();
            createdItems.push(created);

            if (formReminderEnabled && created.scheduled_at && !created.is_completed) {
              const sRes = await scheduleTaskReminderAsync(created, formReminderOffset);
              if (sRes.success) {
                setReminderTaskIds(prev => new Set(prev).add(created.id));
              }
            }
          }
        }

        setTasks(prev => [...createdItems, ...prev]);

        Alert.alert(
          'Event Scheduled',
          createdItems.length > 1
            ? `Scheduled across ${createdItems.length} selected dates successfully!`
            : 'Event created successfully!'
        );
      }

      setEventModalVisible(false);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not save event.');
    } finally {
      setSavingEvent(false);
    }
  }

  // Toggle task complete / pending
  async function handleToggleTask(task: TaskItem) {
    const targetCompleted = !task.is_completed;
    const targetStatus: TaskStatus = targetCompleted ? 'completed' : 'pending';

    setTasks(prev =>
      prev.map(t =>
        t.id === task.id
          ? { ...t, is_completed: targetCompleted, status: targetStatus }
          : t
      )
    );

    if (targetCompleted) {
      await cancelTaskReminderAsync(task.id);
      setReminderTaskIds(prev => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }

    try {
      await fetch(`${TASKS_API_URL}${task.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_completed: targetCompleted, status: targetStatus }),
      });
    } catch (err) {
      console.error('Failed to toggle task:', err);
    }
  }

  // Delete event
  function handleDeleteEvent(task: TaskItem) {
    Alert.alert(
      'Delete Event',
      `Delete "${task.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await fetch(`${TASKS_API_URL}${task.id}/`, { method: 'DELETE' });
              setTasks(prev => prev.filter(t => t.id !== task.id));
              await cancelTaskReminderAsync(task.id);
              setReminderTaskIds(prev => {
                const next = new Set(prev);
                next.delete(task.id);
                return next;
              });
            } catch (err) {
              Alert.alert('Error', 'Could not delete task.');
            }
          },
        },
      ]
    );
  }

  // Save Daily Progress
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

  // Build calendar matrix for current month
  const calendarDays = useMemo(() => {
    const firstDay = new Date(calendarYear, calendarMonth, 1);
    const lastDay = new Date(calendarYear, calendarMonth + 1, 0);
    const totalDays = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay(); // 0 = Sunday

    const cells: Array<{
      dateStr: string;
      dayNum: number;
      isCurrentMonth: boolean;
      isToday: boolean;
      isSelected: boolean;
      isInRange: boolean;
      taskCount: number;
      completedCount: number;
      hasProgress: boolean;
    }> = [];

    // Preceding empty/overflow days
    const prevMonthLastDay = new Date(calendarYear, calendarMonth, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const dayNum = prevMonthLastDay - i;
      const prevDate = new Date(calendarYear, calendarMonth - 1, dayNum);
      const dateStr = getLocalDateString(prevDate);
      cells.push({
        dateStr,
        dayNum,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        isSelected: dateStr === selectedDate,
        isInRange: Boolean(
          rangeStart && rangeEnd && dateStr >= rangeStart && dateStr <= rangeEnd
        ),
        taskCount: (tasksByLocalDate[dateStr] || []).length,
        completedCount: (tasksByLocalDate[dateStr] || []).filter(t => t.is_completed).length,
        hasProgress: Boolean(dailyProgressMap[dateStr]?.description),
      });
    }

    // Days of current month
    for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
      const currDate = new Date(calendarYear, calendarMonth, dayNum);
      const dateStr = getLocalDateString(currDate);
      const dayTasks = tasksByLocalDate[dateStr] || [];
      cells.push({
        dateStr,
        dayNum,
        isCurrentMonth: true,
        isToday: dateStr === todayStr,
        isSelected: dateStr === selectedDate,
        isInRange: Boolean(
          rangeStart && rangeEnd && dateStr >= rangeStart && dateStr <= rangeEnd
        ),
        taskCount: dayTasks.length,
        completedCount: dayTasks.filter(t => t.is_completed).length,
        hasProgress: Boolean(dailyProgressMap[dateStr]?.description),
      });
    }

    // Trailing days to complete grid
    const remaining = (7 - (cells.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      const nextDate = new Date(calendarYear, calendarMonth + 1, i);
      const dateStr = getLocalDateString(nextDate);
      cells.push({
        dateStr,
        dayNum: i,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        isSelected: dateStr === selectedDate,
        isInRange: Boolean(
          rangeStart && rangeEnd && dateStr >= rangeStart && dateStr <= rangeEnd
        ),
        taskCount: (tasksByLocalDate[dateStr] || []).length,
        completedCount: (tasksByLocalDate[dateStr] || []).filter(t => t.is_completed).length,
        hasProgress: Boolean(dailyProgressMap[dateStr]?.description),
      });
    }

    return cells;
  }, [calendarYear, calendarMonth, todayStr, selectedDate, rangeStart, rangeEnd, tasksByLocalDate, dailyProgressMap]);

  const monthName = new Date(calendarYear, calendarMonth, 1).toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  });

  return (
    <ScrollView
      style={styles.screen}
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
            <Text style={styles.brandTitle}>StockFlow Planner</Text>
            <Text style={styles.brandSubtitle}>Calendar, Tasks & Daily Journal</Text>
          </View>
        </View>

        {/* Quick Month Navigation */}
        <View style={styles.monthNavRow}>
          <Pressable style={styles.monthNavBtn} onPress={prevMonth} accessibilityLabel="Previous month">
            <Text style={styles.monthNavBtnText}>◀</Text>
          </Pressable>
          <Text style={styles.monthTitleText}>{monthName}</Text>
          <Pressable style={styles.monthNavBtn} onPress={nextMonth} accessibilityLabel="Next month">
            <Text style={styles.monthNavBtnText}>▶</Text>
          </Pressable>
        </View>
      </View>

      {/* Range Status Bar */}
      {rangeStart && (
        <View style={styles.rangeBanner}>
          <View style={styles.rangeBannerTextWrap}>
            <Text style={styles.rangeBannerTitle}>
              🗓 Range Selected: {rangeStart} {rangeEnd ? `to ${rangeEnd} (${activeRangeDays.length} days)` : '(Tap end date)'}
            </Text>
            <Text style={styles.rangeBannerSubtitle}>
              Tap any date in range to inspect or assign events.
            </Text>
          </View>
          <Pressable style={styles.rangeClearBtn} onPress={clearRangeSelection}>
            <Text style={styles.rangeClearBtnText}>Clear</Text>
          </Pressable>
        </View>
      )}

      {/* Monthly Calendar Card */}
      <View style={styles.calendarCard}>
        {/* Day of Week Headers */}
        <View style={styles.weekDaysRow}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <Text key={day} style={styles.weekDayText}>
              {day}
            </Text>
          ))}
        </View>

        {/* Calendar Grid */}
        <View style={styles.calendarGrid}>
          {calendarDays.map((cell, idx) => {
            const isRangeEndpoint =
              cell.dateStr === rangeStart || cell.dateStr === rangeEnd;

            return (
              <Pressable
                key={`${cell.dateStr}-${idx}`}
                style={[
                  styles.dayCell,
                  !cell.isCurrentMonth && styles.dayCellOutside,
                  cell.isInRange && styles.dayCellInRange,
                  isRangeEndpoint && styles.dayCellRangeEndpoint,
                  cell.isSelected && styles.dayCellSelected,
                  cell.isToday && !cell.isSelected && styles.dayCellToday,
                ]}
                onPress={() => handleDayTap(cell.dateStr)}
              >
                <Text
                  style={[
                    styles.dayNumText,
                    !cell.isCurrentMonth && styles.dayNumTextOutside,
                    cell.isToday && styles.dayNumTextToday,
                    cell.isSelected && styles.dayNumTextSelected,
                  ]}
                >
                  {cell.dayNum}
                </Text>

                {/* Badges / Indicators */}
                <View style={styles.dayIndicatorsRow}>
                  {cell.taskCount > 0 && (
                    <View
                      style={[
                        styles.taskCountBadge,
                        cell.completedCount === cell.taskCount && styles.taskCountBadgeDone,
                      ]}
                    >
                      <Text style={styles.taskCountBadgeText}>{cell.taskCount}</Text>
                    </View>
                  )}
                  {cell.hasProgress && (
                    <Text style={styles.progressDotIcon}>📝</Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#4263EB' }]} />
            <Text style={styles.legendText}>Tasks</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#059669' }]} />
            <Text style={styles.legendText}>Done</Text>
          </View>
          <View style={styles.legendItem}>
            <Text style={{ fontSize: 11 }}>📝</Text>
            <Text style={styles.legendText}>Journal</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#E0E7FF', borderColor: '#4263EB', borderWidth: 1 }]} />
            <Text style={styles.legendText}>Selected</Text>
          </View>
        </View>
      </View>

      {/* Segmented Section Switcher */}
      <View style={styles.sectionTabs}>
        <Pressable
          style={[styles.sectionTabBtn, activeTab === 'day' && styles.sectionTabBtnActive]}
          onPress={() => setActiveTab('day')}
        >
          <Text style={[styles.sectionTabBtnText, activeTab === 'day' && styles.sectionTabBtnTextActive]}>
            Day Events ({selectedDateTasks.length})
          </Text>
        </Pressable>

        <Pressable
          style={[styles.sectionTabBtn, activeTab === 'range' && styles.sectionTabBtnActive]}
          onPress={() => setActiveTab('range')}
        >
          <Text style={[styles.sectionTabBtnText, activeTab === 'range' && styles.sectionTabBtnTextActive]}>
            Range Agenda {activeRangeDays.length > 0 ? `(${activeRangeDays.length}D)` : ''}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.sectionTabBtn, activeTab === 'tracker' && styles.sectionTabBtnActive]}
          onPress={() => setActiveTab('tracker')}
        >
          <Text style={[styles.sectionTabBtnText, activeTab === 'tracker' && styles.sectionTabBtnTextActive]}>
            Weekly 8D Tracker
          </Text>
        </Pressable>
      </View>

      {/* TAB 1: Selected Day Events & Management */}
      {activeTab === 'day' && (
        <View style={styles.contentSection}>
          {/* Day Header Banner */}
          <View style={styles.dayHeaderCard}>
            <View style={styles.dayHeaderInfo}>
              <Text style={styles.dayHeaderTitle}>{formatFriendlyDate(selectedDate)}</Text>
              <Text style={styles.dayHeaderMetrics}>
                {selectedDayMetrics.total === 0
                  ? 'No scheduled tasks'
                  : `${selectedDayMetrics.completed}/${selectedDayMetrics.total} completed (${selectedDayMetrics.percent}%)`}
              </Text>
            </View>

            <Pressable
              style={styles.addEventBtn}
              onPress={() => openCreateEventModal(selectedDate)}
            >
              <Text style={styles.addEventBtnText}>+ Add Event</Text>
            </Pressable>
          </View>

          {/* Events List for Day */}
          {selectedDateTasks.length === 0 ? (
            <View style={styles.emptyDayCard}>
              <Text style={styles.emptyDayEmoji}>📅</Text>
              <Text style={styles.emptyDayTitle}>No events scheduled for this day</Text>
              <Text style={styles.emptyDaySubtitle}>
                Tap "+ Add Event" above to assign a task, restock audit, or delivery to {selectedDate}.
              </Text>
            </View>
          ) : (
            <View style={styles.eventsList}>
              {selectedDateTasks.map(task => {
                const { label: timeDisplay, isOverdue } = formatScheduledDisplay(task.scheduled_at);
                const hasReminder = reminderTaskIds.has(task.id);

                return (
                  <View
                    key={task.id}
                    style={[
                      styles.eventCard,
                      task.is_completed && styles.eventCardCompleted,
                    ]}
                  >
                    <View style={styles.eventCardRow}>
                      <Pressable
                        style={[
                          styles.checkbox,
                          task.is_completed && styles.checkboxCompleted,
                        ]}
                        onPress={() => handleToggleTask(task)}
                      >
                        {task.is_completed && <Text style={styles.checkboxCheck}>✓</Text>}
                      </Pressable>

                      <View style={styles.eventBody}>
                        <Text
                          style={[
                            styles.eventTitle,
                            task.is_completed && styles.eventTitleCompleted,
                          ]}
                        >
                          {task.title}
                        </Text>

                        {Boolean(task.description) && (
                          <Text style={styles.eventDescription} numberOfLines={2}>
                            {task.description}
                          </Text>
                        )}

                        <View style={styles.eventBadgesRow}>
                          <View
                            style={[
                              styles.priorityBadge,
                              task.priority === 'high' && styles.priorityHigh,
                              task.priority === 'medium' && styles.priorityMedium,
                              task.priority === 'low' && styles.priorityLow,
                            ]}
                          >
                            <Text style={styles.priorityBadgeText}>
                              {(task.priority || 'medium').toUpperCase()}
                            </Text>
                          </View>

                          <View
                            style={[
                              styles.statusBadge,
                              task.is_completed
                                ? styles.statusCompleted
                                : task.status === 'in_progress'
                                  ? styles.statusInProgress
                                  : styles.statusPending,
                            ]}
                          >
                            <Text style={styles.statusBadgeText}>
                              {task.is_completed
                                ? 'COMPLETED'
                                : (task.status || 'pending').replace('_', ' ').toUpperCase()}
                            </Text>
                          </View>

                          <Text
                            style={[
                              styles.timeBadgeText,
                              isOverdue && !task.is_completed && styles.timeBadgeOverdue,
                            ]}
                          >
                            {isOverdue && !task.is_completed ? '⚠️ ' : '⏰ '}
                            {timeDisplay}
                          </Text>

                          {hasReminder && (
                            <Text style={styles.reminderActiveText}>🔔 Alert on</Text>
                          )}
                        </View>
                      </View>

                      {/* Event Actions: Edit & Delete */}
                      <View style={styles.eventActionsCol}>
                        <Pressable
                          style={styles.editActionBtn}
                          onPress={() => openEditEventModal(task)}
                        >
                          <Text style={styles.editActionBtnText}>Edit</Text>
                        </Pressable>
                        <Pressable
                          style={styles.deleteActionBtn}
                          onPress={() => handleDeleteEvent(task)}
                        >
                          <Text style={styles.deleteActionBtnText}>✕</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Daily Progress & Journal Card */}
          <View style={styles.journalCard}>
            <View style={styles.journalHeader}>
              <View>
                <Text style={styles.journalTitle}>📝 Daily Progress Journal</Text>
                <Text style={styles.journalSubtitle}>
                  Record accomplishments for {selectedDate}
                </Text>
              </View>
              {progressSaveSuccess && (
                <Text style={styles.saveSuccessPill}>Saved to Cloud ✓</Text>
              )}
            </View>

            <View style={styles.journalFieldGroup}>
              <Text style={styles.journalLabel}>What did you accomplish today? *</Text>
              <TextInput
                style={[styles.journalInput, styles.journalTextArea]}
                placeholder="e.g. Conducted stock audit of 50 SKUs, reconciled dairy cooler quantities..."
                placeholderTextColor="#94A3B8"
                value={currentProgress.description}
                onChangeText={text =>
                  setCurrentProgress(prev => ({ ...prev, description: text }))
                }
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.journalFieldGroup}>
              <Text style={styles.journalLabel}>Key Achievements & Milestones (Optional)</Text>
              <TextInput
                style={styles.journalInput}
                placeholder="e.g. Zero inventory discrepancies in Section B"
                placeholderTextColor="#94A3B8"
                value={currentProgress.achievements || ''}
                onChangeText={text =>
                  setCurrentProgress(prev => ({ ...prev, achievements: text }))
                }
              />
            </View>

            <View style={styles.journalFieldGroup}>
              <Text style={styles.journalLabel}>Blockers & Difficulties (Optional)</Text>
              <TextInput
                style={styles.journalInput}
                placeholder="e.g. Scanner Wi-Fi connectivity dropped twice"
                placeholderTextColor="#94A3B8"
                value={currentProgress.blockers || ''}
                onChangeText={text =>
                  setCurrentProgress(prev => ({ ...prev, blockers: text }))
                }
              />
            </View>

            <View style={styles.journalFieldGroup}>
              <Text style={styles.journalLabel}>Next Steps (Optional)</Text>
              <TextInput
                style={styles.journalInput}
                placeholder="e.g. Reorder 20 cartons of organic butter tomorrow"
                placeholderTextColor="#94A3B8"
                value={currentProgress.next_steps || ''}
                onChangeText={text =>
                  setCurrentProgress(prev => ({ ...prev, next_steps: text }))
                }
              />
            </View>

            <Pressable
              style={[styles.saveJournalBtn, savingProgress && { opacity: 0.7 }]}
              disabled={savingProgress}
              onPress={handleSaveDailyProgress}
            >
              <Text style={styles.saveJournalBtnText}>
                {savingProgress ? 'Saving Journal...' : 'Save Daily Progress'}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* TAB 2: Range Agenda View */}
      {activeTab === 'range' && (
        <View style={styles.contentSection}>
          <View style={styles.rangeSummaryCard}>
            <Text style={styles.rangeSummaryTitle}>
              {rangeStart && rangeEnd
                ? `Selected Range: ${rangeStart} to ${rangeEnd}`
                : rangeStart
                  ? `Selected Start: ${rangeStart}`
                  : 'No Range Selected'}
            </Text>
            <Text style={styles.rangeSummaryDesc}>
              {activeRangeDays.length > 0
                ? `${activeRangeDays.length} days in planning scope. Tap any day to inspect details or assign events.`
                : 'Tap a start date and an end date on the calendar above to define a multi-day planning range.'}
            </Text>
            {activeRangeDays.length > 1 && (
              <Pressable
                style={styles.scheduleAcrossRangeBtn}
                onPress={() => {
                  openCreateEventModal(rangeStart || selectedDate);
                  setScheduleAcrossRange(true);
                }}
              >
                <Text style={styles.scheduleAcrossRangeBtnText}>
                  + Schedule Event Across Selected Range
                </Text>
              </Pressable>
            )}
          </View>

          {activeRangeDays.map(dateStr => {
            const dayTasks = tasksByLocalDate[dateStr] || [];
            const completed = dayTasks.filter(t => t.is_completed).length;
            const total = dayTasks.length;
            const percent = total > 0 ? Math.round((completed / total) * 100) : null;
            const hasProgress = Boolean(dailyProgressMap[dateStr]?.description);

            return (
              <Pressable
                key={dateStr}
                style={[
                  styles.agendaDayCard,
                  dateStr === selectedDate && styles.agendaDayCardSelected,
                ]}
                onPress={() => {
                  setSelectedDate(dateStr);
                  setActiveTab('day');
                }}
              >
                <View style={styles.agendaDayHeader}>
                  <Text style={styles.agendaDayTitle}>
                    {formatFriendlyDate(dateStr)}
                    {dateStr === todayStr ? ' (Today)' : ''}
                  </Text>
                  <Text style={styles.agendaDayMetricText}>
                    {total === 0 ? '0 tasks' : `${completed}/${total} completed (${percent}%)`}
                  </Text>
                </View>

                {total > 0 && percent !== null && (
                  <View style={styles.progressBarTrack}>
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${percent}%`,
                          backgroundColor: percent === 100 ? '#059669' : '#4263EB',
                        },
                      ]}
                    />
                  </View>
                )}

                {hasProgress && (
                  <Text style={styles.agendaJournalSnippet} numberOfLines={1}>
                    📝 {dailyProgressMap[dateStr]?.description}
                  </Text>
                )}

                {dayTasks.length > 0 ? (
                  <View style={styles.agendaTasksWrap}>
                    {dayTasks.slice(0, 3).map(t => (
                      <Text
                        key={t.id}
                        style={[
                          styles.agendaTaskSnippet,
                          t.is_completed && styles.agendaTaskSnippetDone,
                        ]}
                        numberOfLines={1}
                      >
                        {t.is_completed ? '✓ ' : '• '} {t.title}
                      </Text>
                    ))}
                    {dayTasks.length > 3 && (
                      <Text style={styles.agendaMoreText}>
                        +{dayTasks.length - 3} more tasks...
                      </Text>
                    )}
                  </View>
                ) : (
                  <Text style={styles.agendaNoTasksText}>No events scheduled yet.</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      {/* TAB 3: Weekly 8-Day Progress Tracker */}
      {activeTab === 'tracker' && (
        <View style={styles.contentSection}>
          <View style={styles.trackerSummaryCard}>
            <Text style={styles.trackerSummaryTitle}>8-Day Continuous Progress Tracker</Text>
            <Text style={styles.trackerSummaryDesc}>
              Tracking today and the next seven calendar days with completion rates and written progress.
            </Text>
          </View>

          {eightDayTracker.map(dayItem => (
            <Pressable
              key={dayItem.dateStr}
              style={[
                styles.trackerDayCard,
                dayItem.isToday && styles.trackerDayCardToday,
                dayItem.dateStr === selectedDate && styles.trackerDayCardSelected,
              ]}
              onPress={() => {
                setSelectedDate(dayItem.dateStr);
                setActiveTab('day');
              }}
            >
              <View style={styles.trackerRowHeader}>
                <View>
                  <Text style={styles.trackerDayTitle}>
                    {dayItem.dayName}, {dayItem.displayDate}
                    {dayItem.isToday ? ' · Today' : ''}
                  </Text>
                  <Text style={styles.trackerDayCounts}>
                    {dayItem.total === 0
                      ? 'No tasks scheduled'
                      : `${dayItem.completed} completed · ${dayItem.pending} pending`}
                  </Text>
                </View>

                {dayItem.percent !== null ? (
                  <View
                    style={[
                      styles.trackerPercentPill,
                      dayItem.percent === 100 && styles.trackerPercentPillDone,
                    ]}
                  >
                    <Text style={styles.trackerPercentPillText}>{dayItem.percent}%</Text>
                  </View>
                ) : (
                  <Text style={styles.trackerNoTasksText}>–</Text>
                )}
              </View>

              {dayItem.percent !== null && (
                <View style={styles.progressBarTrack}>
                  <View
                    style={[
                      styles.progressBarFill,
                      {
                        width: `${dayItem.percent}%`,
                        backgroundColor: dayItem.percent === 100 ? '#059669' : '#4263EB',
                      },
                    ]}
                  />
                </View>
              )}

              {Boolean(dayItem.nextUpcoming) && (
                <Text style={styles.trackerUpcomingText} numberOfLines={1}>
                  Next: {dayItem.nextUpcoming?.title}
                </Text>
              )}

              {Boolean(dayItem.progressDescription) && (
                <Text style={styles.trackerJournalText} numberOfLines={2}>
                  📝 Progress: {dayItem.progressDescription}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      )}

      {/* EVENT CREATE / EDIT MODAL */}
      <Modal
        visible={eventModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setEventModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingTask ? 'Edit Event / Task' : 'Schedule New Event'}
              </Text>
              <Pressable
                style={styles.modalCloseBtn}
                onPress={() => setEventModalVisible(false)}
              >
                <Text style={styles.modalCloseBtnText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.modalScroll}>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Title *</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g. Weekly freezer temperature audit"
                  placeholderTextColor="#94A3B8"
                  value={formTitle}
                  onChangeText={setFormTitle}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Detailed Description</Text>
                <TextInput
                  style={[styles.formInput, styles.formTextArea]}
                  placeholder="Optional instructions, steps, or items to count"
                  placeholderTextColor="#94A3B8"
                  value={formDescription}
                  onChangeText={setFormDescription}
                  multiline
                  numberOfLines={2}
                />
              </View>

              {/* Date & Time Settings */}
              <View style={styles.formRow}>
                <View style={[styles.formGroup, { flex: 1.2 }]}>
                  <Text style={styles.formLabel}>Date (YYYY-MM-DD)</Text>
                  <TextInput
                    style={styles.formInput}
                    value={formDate}
                    onChangeText={setFormDate}
                  />
                </View>
                <View style={[styles.formGroup, { flex: 0.8 }]}>
                  <Text style={styles.formLabel}>Start Time</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder="09:00 or 5:48 PM"
                    placeholderTextColor="#94A3B8"
                    value={formStartTime}
                    onChangeText={setFormStartTime}
                  />
                </View>
              </View>

              {/* End Time Toggle & Input */}
              <View style={styles.formGroup}>
                <Pressable
                  style={styles.checkboxRow}
                  onPress={() => setFormHasEndTime(!formHasEndTime)}
                >
                  <View
                    style={[styles.checkboxSmall, formHasEndTime && styles.checkboxSmallChecked]}
                  >
                    {formHasEndTime && <Text style={styles.checkboxSmallCheck}>✓</Text>}
                  </View>
                  <Text style={styles.checkboxRowLabel}>Set Optional End Time</Text>
                </Pressable>

                {formHasEndTime && (
                  <TextInput
                    style={[styles.formInput, { marginTop: 6 }]}
                    placeholder="10:00 or 6:30 PM"
                    placeholderTextColor="#94A3B8"
                    value={formEndTime}
                    onChangeText={setFormEndTime}
                  />
                )}
              </View>

              {/* Multi-date Option if range is active and not editing */}
              {!editingTask && activeRangeDays.length > 1 && (
                <View style={styles.formGroup}>
                  <Pressable
                    style={styles.checkboxRow}
                    onPress={() => setScheduleAcrossRange(!scheduleAcrossRange)}
                  >
                    <View
                      style={[
                        styles.checkboxSmall,
                        scheduleAcrossRange && styles.checkboxSmallChecked,
                      ]}
                    >
                      {scheduleAcrossRange && <Text style={styles.checkboxSmallCheck}>✓</Text>}
                    </View>
                    <Text style={styles.checkboxRowLabel}>
                      Schedule across all {activeRangeDays.length} days in selected range
                    </Text>
                  </Pressable>
                </View>
              )}

              {/* Priority Selector */}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Priority</Text>
                <View style={styles.selectorRow}>
                  {(['low', 'medium', 'high'] as const).map(p => (
                    <Pressable
                      key={p}
                      style={[
                        styles.selectorOption,
                        formPriority === p && styles.selectorOptionActive,
                      ]}
                      onPress={() => setFormPriority(p)}
                    >
                      <Text
                        style={[
                          styles.selectorOptionText,
                          formPriority === p && styles.selectorOptionTextActive,
                        ]}
                      >
                        {p.toUpperCase()}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Status Selector */}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Status</Text>
                <View style={styles.selectorRow}>
                  {(['pending', 'in_progress', 'completed'] as const).map(st => (
                    <Pressable
                      key={st}
                      style={[
                        styles.selectorOption,
                        formStatus === st && styles.selectorOptionActive,
                      ]}
                      onPress={() => setFormStatus(st)}
                    >
                      <Text
                        style={[
                          styles.selectorOptionText,
                          formStatus === st && styles.selectorOptionTextActive,
                        ]}
                      >
                        {st.replace('_', ' ').toUpperCase()}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Optional Notes */}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Progress Update & Notes</Text>
                <TextInput
                  style={[styles.formInput, styles.formTextArea]}
                  placeholder="Optional notes or observations"
                  placeholderTextColor="#94A3B8"
                  value={formNotes}
                  onChangeText={setFormNotes}
                  multiline
                  numberOfLines={2}
                />
              </View>

              {/* Reminder Settings */}
              <View style={styles.reminderCard}>
                <Pressable
                  style={styles.checkboxRow}
                  onPress={() => setFormReminderEnabled(!formReminderEnabled)}
                >
                  <View
                    style={[
                      styles.checkboxSmall,
                      formReminderEnabled && styles.checkboxSmallChecked,
                    ]}
                  >
                    {formReminderEnabled && <Text style={styles.checkboxSmallCheck}>✓</Text>}
                  </View>
                  <Text style={styles.checkboxRowLabel}>
                    🔔 Enable local device notification reminder
                  </Text>
                </Pressable>

                {formReminderEnabled && (
                  <View style={styles.reminderOffsetsRow}>
                    {[
                      { label: 'At due time', val: 0 },
                      { label: '15m before', val: 15 },
                      { label: '1h before', val: 60 },
                      { label: '1d before', val: 1440 },
                    ].map(item => (
                      <Pressable
                        key={item.val}
                        style={[
                          styles.offsetPill,
                          formReminderOffset === item.val && styles.offsetPillActive,
                        ]}
                        onPress={() => setFormReminderOffset(item.val)}
                      >
                        <Text
                          style={[
                            styles.offsetPillText,
                            formReminderOffset === item.val && styles.offsetPillTextActive,
                          ]}
                        >
                          {item.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setEventModalVisible(false)}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={[styles.modalSaveBtn, savingEvent && { opacity: 0.7 }]}
                disabled={savingEvent}
                onPress={handleSaveEvent}
              >
                <Text style={styles.modalSaveBtnText}>
                  {savingEvent ? 'Saving...' : editingTask ? 'Update Event' : 'Save Event'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  },
  headerBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
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
  brandTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '700',
  },
  brandSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
  },
  monthNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  monthNavBtn: {
    padding: 6,
  },
  monthNavBtnText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  monthTitleText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  rangeBanner: {
    backgroundColor: '#EEF2FF',
    borderBottomWidth: 1,
    borderBottomColor: '#C7D2FE',
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rangeBannerTextWrap: {
    flex: 1,
  },
  rangeBannerTitle: {
    color: '#3730A3',
    fontSize: 13,
    fontWeight: '700',
  },
  rangeBannerSubtitle: {
    color: '#4F46E5',
    fontSize: 11,
    marginTop: 2,
  },
  rangeClearBtn: {
    backgroundColor: '#E0E7FF',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginLeft: 8,
  },
  rangeClearBtnText: {
    color: '#3730A3',
    fontSize: 12,
    fontWeight: '600',
  },
  calendarCard: {
    backgroundColor: '#FFFFFF',
    margin: 12,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  weekDaysRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 8,
    marginBottom: 4,
  },
  weekDayText: {
    width: '14.28%',
    textAlign: 'center',
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.28%',
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 2,
    borderRadius: 8,
  },
  dayCellOutside: {
    opacity: 0.35,
  },
  dayCellInRange: {
    backgroundColor: '#EEF2FF',
  },
  dayCellRangeEndpoint: {
    backgroundColor: '#C7D2FE',
    borderWidth: 1,
    borderColor: '#4263EB',
  },
  dayCellSelected: {
    backgroundColor: '#4263EB',
  },
  dayCellToday: {
    borderWidth: 1.5,
    borderColor: '#4263EB',
  },
  dayNumText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
  },
  dayNumTextOutside: {
    color: '#94A3B8',
  },
  dayNumTextToday: {
    color: '#4263EB',
    fontWeight: '800',
  },
  dayNumTextSelected: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  dayIndicatorsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 2,
    height: 14,
  },
  taskCountBadge: {
    backgroundColor: '#4263EB',
    borderRadius: 6,
    paddingHorizontal: 4,
    height: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  taskCountBadgeDone: {
    backgroundColor: '#059669',
  },
  taskCountBadgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
  },
  progressDotIcon: {
    fontSize: 9,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 8,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    color: '#64748B',
  },
  sectionTabs: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 8,
    padding: 2,
  },
  sectionTabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  sectionTabBtnActive: {
    backgroundColor: '#FFFFFF',
  },
  sectionTabBtnText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  sectionTabBtnTextActive: {
    color: '#1E293B',
    fontWeight: '700',
  },
  contentSection: {
    paddingHorizontal: 12,
    paddingBottom: 40,
  },
  dayHeaderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  dayHeaderInfo: {
    flex: 1,
  },
  dayHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  dayHeaderMetrics: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  addEventBtn: {
    backgroundColor: '#4263EB',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  addEventBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyDayCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  emptyDayEmoji: {
    fontSize: 32,
    marginBottom: 8,
  },
  emptyDayTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 4,
  },
  emptyDaySubtitle: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  eventsList: {
    gap: 8,
    marginBottom: 12,
  },
  eventCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  eventCardCompleted: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
    opacity: 0.85,
  },
  eventCardRow: {
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
  checkboxCheck: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  eventBody: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
  },
  eventTitleCompleted: {
    textDecorationLine: 'line-through',
    color: '#64748B',
  },
  eventDescription: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  eventBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  priorityBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  priorityHigh: { backgroundColor: '#FEE2E2' },
  priorityMedium: { backgroundColor: '#FEF3C7' },
  priorityLow: { backgroundColor: '#E0E7FF' },
  priorityBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1E293B',
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusPending: { backgroundColor: '#F1F5F9' },
  statusInProgress: { backgroundColor: '#E0F2FE' },
  statusCompleted: { backgroundColor: '#D1FAE5' },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1E293B',
  },
  timeBadgeText: {
    fontSize: 11,
    color: '#64748B',
  },
  timeBadgeOverdue: {
    color: '#DC2626',
    fontWeight: '700',
  },
  reminderActiveText: {
    fontSize: 10,
    color: '#4263EB',
    fontWeight: '600',
  },
  eventActionsCol: {
    alignItems: 'flex-end',
    gap: 6,
  },
  editActionBtn: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    backgroundColor: '#EEF2FF',
  },
  editActionBtnText: {
    color: '#4263EB',
    fontSize: 11,
    fontWeight: '600',
  },
  deleteActionBtn: {
    padding: 4,
  },
  deleteActionBtnText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  journalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  journalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  journalTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  journalSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  saveSuccessPill: {
    backgroundColor: '#D1FAE5',
    color: '#065F46',
    fontSize: 11,
    fontWeight: '700',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  journalFieldGroup: {
    marginBottom: 10,
  },
  journalLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 4,
  },
  journalInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 13,
    color: '#1E293B',
  },
  journalTextArea: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  saveJournalBtn: {
    backgroundColor: '#1E293B',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  saveJournalBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  rangeSummaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  rangeSummaryTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
  },
  rangeSummaryDesc: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    marginBottom: 8,
  },
  scheduleAcrossRangeBtn: {
    backgroundColor: '#4263EB',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  scheduleAcrossRangeBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  agendaDayCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  agendaDayCardSelected: {
    borderColor: '#4263EB',
    borderWidth: 1.5,
  },
  agendaDayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  agendaDayTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
  },
  agendaDayMetricText: {
    fontSize: 12,
    color: '#64748B',
  },
  agendaJournalSnippet: {
    fontSize: 12,
    color: '#475569',
    fontStyle: 'italic',
    marginVertical: 4,
  },
  agendaTasksWrap: {
    gap: 2,
    marginTop: 4,
  },
  agendaTaskSnippet: {
    fontSize: 12,
    color: '#334155',
  },
  agendaTaskSnippetDone: {
    textDecorationLine: 'line-through',
    color: '#94A3B8',
  },
  agendaMoreText: {
    fontSize: 11,
    color: '#4263EB',
    fontWeight: '600',
    marginTop: 2,
  },
  agendaNoTasksText: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  trackerSummaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  trackerSummaryTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
  },
  trackerSummaryDesc: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  trackerDayCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  trackerDayCardToday: {
    borderColor: '#4263EB',
    backgroundColor: '#F8FAFC',
  },
  trackerDayCardSelected: {
    borderColor: '#4263EB',
    borderWidth: 1.5,
  },
  trackerRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  trackerDayTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  trackerDayCounts: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  trackerPercentPill: {
    backgroundColor: '#EEF2FF',
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  trackerPercentPillDone: {
    backgroundColor: '#D1FAE5',
  },
  trackerPercentPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1E293B',
  },
  trackerNoTasksText: {
    fontSize: 13,
    color: '#94A3B8',
  },
  trackerUpcomingText: {
    fontSize: 11,
    color: '#0284C7',
    fontWeight: '600',
    marginTop: 4,
  },
  trackerJournalText: {
    fontSize: 11,
    color: '#475569',
    marginTop: 4,
    fontStyle: 'italic',
  },
  progressBarTrack: {
    height: 5,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    overflow: 'hidden',
    marginVertical: 4,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '90%',
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalCloseBtnText: {
    fontSize: 18,
    color: '#64748B',
  },
  modalScroll: {
    maxHeight: 460,
  },
  formGroup: {
    marginBottom: 10,
  },
  formRow: {
    flexDirection: 'row',
    gap: 8,
  },
  formLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 4,
  },
  formInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 6,
    paddingVertical: 7,
    paddingHorizontal: 10,
    fontSize: 13,
    color: '#1E293B',
  },
  formTextArea: {
    minHeight: 52,
    textAlignVertical: 'top',
  },
  selectorRow: {
    flexDirection: 'row',
    gap: 6,
  },
  selectorOption: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 6,
  },
  selectorOptionActive: {
    backgroundColor: '#4263EB',
  },
  selectorOptionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  selectorOptionTextActive: {
    color: '#FFFFFF',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkboxSmall: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#94A3B8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSmallChecked: {
    backgroundColor: '#4263EB',
    borderColor: '#4263EB',
  },
  checkboxSmallCheck: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  checkboxRowLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  reminderCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  reminderOffsetsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  offsetPill: {
    flex: 1,
    backgroundColor: '#E2E8F0',
    paddingVertical: 4,
    alignItems: 'center',
    borderRadius: 4,
  },
  offsetPillActive: {
    backgroundColor: '#4263EB',
  },
  offsetPillText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#475569',
  },
  offsetPillTextActive: {
    color: '#FFFFFF',
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  modalCancelBtnText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '600',
  },
  modalSaveBtn: {
    flex: 2,
    backgroundColor: '#4263EB',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  modalSaveBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
