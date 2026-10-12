import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Task, CalendarSubTab } from './types';
import { TaskCard } from './TaskCard';
import { DailyProgress } from '@/services/daily-progress';
import {
  getLocalDateString,
  getDateRangeDays,
  formatFriendlyDate,
  getEightDayWindow,
} from '@/utils/timezone';

interface CalendarSectionProps {
  tasks: Task[];
  tasksByLocalDate: Record<string, Task[]>;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  rangeStart: string | null;
  rangeEnd: string | null;
  onSetRangeStart: (date: string | null) => void;
  onSetRangeEnd: (date: string | null) => void;
  dailyProgressMap: Record<string, DailyProgress>;
  reminderTaskIds: Set<number>;
  deletingTaskId: number | null;
  onToggleComplete: (task: Task) => void;
  onToggleReminder: (task: Task) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
  onOpenCreateTask: (targetDate?: string) => void;
  onOpenCreateAcrossRange: (startDate: string) => void;
}

export const CalendarSection: React.FC<CalendarSectionProps> = ({
  tasksByLocalDate,
  selectedDate,
  onSelectDate,
  rangeStart,
  rangeEnd,
  onSetRangeStart,
  onSetRangeEnd,
  dailyProgressMap,
  reminderTaskIds,
  deletingTaskId,
  onToggleComplete,
  onToggleReminder,
  onEditTask,
  onDeleteTask,
  onOpenCreateTask,
  onOpenCreateAcrossRange,
}) => {
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth());
  const [subTab, setSubTab] = useState<CalendarSubTab>('day');

  const todayStr = useMemo(() => getLocalDateString(), []);
  const tomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return getLocalDateString(d);
  }, []);

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

  function selectToday() {
    const now = new Date();
    onSelectDate(todayStr);
    setCalendarYear(now.getFullYear());
    setCalendarMonth(now.getMonth());
    setSubTab('day');
  }

  function selectTomorrow() {
    const now = new Date();
    const tom = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    onSelectDate(tomorrowStr);
    setCalendarYear(tom.getFullYear());
    setCalendarMonth(tom.getMonth());
    setSubTab('day');
  }

  function handleDayTap(dateStr: string) {
    onSelectDate(dateStr);

    if (!rangeStart || (rangeStart && rangeEnd)) {
      onSetRangeStart(dateStr);
      onSetRangeEnd(null);
    } else if (rangeStart && !rangeEnd) {
      if (dateStr < rangeStart) {
        onSetRangeEnd(rangeStart);
        onSetRangeStart(dateStr);
      } else {
        onSetRangeEnd(dateStr);
      }
    }
  }

  function clearRange() {
    onSetRangeStart(null);
    onSetRangeEnd(null);
  }

  const activeRangeDays = useMemo(() => {
    if (rangeStart && rangeEnd) {
      return getDateRangeDays(rangeStart, rangeEnd);
    }
    if (rangeStart) {
      return [rangeStart];
    }
    return [];
  }, [rangeStart, rangeEnd]);

  // Tasks for currently selected date
  const selectedDateTasks = useMemo(() => {
    return tasksByLocalDate[selectedDate] || [];
  }, [tasksByLocalDate, selectedDate]);

  // Selected day metrics
  const selectedDayMetrics = useMemo(() => {
    const total = selectedDateTasks.length;
    const completed = selectedDateTasks.filter(t => t.is_completed || t.status === 'completed').length;
    const pending = total - completed;
    const percent = total > 0 ? Math.round((completed / total) * 100) : null;
    return { total, completed, pending, percent };
  }, [selectedDateTasks]);

  // 8-Day tracker window
  const eightDayTracker = useMemo(() => {
    const windowDays = getEightDayWindow(new Date());
    return windowDays.map(d => {
      const dateStr = getLocalDateString(d);
      const dayTasks = tasksByLocalDate[dateStr] || [];
      const total = dayTasks.length;
      const completed = dayTasks.filter(t => t.is_completed || t.status === 'completed').length;
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
        percent,
        progressDescription: progressEntry?.description || '',
        nextUpcoming,
      };
    });
  }, [tasksByLocalDate, dailyProgressMap, todayStr]);

  // Month grid
  const calendarDays = useMemo(() => {
    const firstDay = new Date(calendarYear, calendarMonth, 1);
    const lastDay = new Date(calendarYear, calendarMonth + 1, 0);
    const totalDays = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

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

    // Preceding month overflow
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
        isInRange: Boolean(rangeStart && rangeEnd && dateStr >= rangeStart && dateStr <= rangeEnd),
        taskCount: (tasksByLocalDate[dateStr] || []).length,
        completedCount: (tasksByLocalDate[dateStr] || []).filter(t => t.is_completed).length,
        hasProgress: Boolean(dailyProgressMap[dateStr]?.description),
      });
    }

    // Current month days
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
        isInRange: Boolean(rangeStart && rangeEnd && dateStr >= rangeStart && dateStr <= rangeEnd),
        taskCount: dayTasks.length,
        completedCount: dayTasks.filter(t => t.is_completed).length,
        hasProgress: Boolean(dailyProgressMap[dateStr]?.description),
      });
    }

    // Trailing days
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
        isInRange: Boolean(rangeStart && rangeEnd && dateStr >= rangeStart && dateStr <= rangeEnd),
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
    <View style={styles.container}>
      {/* Month Navigation Row */}
      <View style={styles.monthNavRow}>
        <Pressable style={styles.monthNavBtn} onPress={prevMonth} accessibilityLabel="Previous month">
          <Text style={styles.monthNavBtnText}>◀</Text>
        </Pressable>
        <Text style={styles.monthTitleText}>{monthName}</Text>
        <Pressable style={styles.monthNavBtn} onPress={nextMonth} accessibilityLabel="Next month">
          <Text style={styles.monthNavBtnText}>▶</Text>
        </Pressable>
      </View>

      {/* Quick Day Switcher Bar: Today & Tomorrow */}
      <View style={styles.quickDaySwitcherBar}>
        <Pressable
          style={[
            styles.quickDayBtn,
            selectedDate === todayStr && styles.quickDayBtnActive,
          ]}
          onPress={selectToday}
          accessibilityLabel="Quick View Today's Tasks"
        >
          <View style={styles.quickDayBtnLeft}>
            <Text
              style={[
                styles.quickDayTitle,
                selectedDate === todayStr && styles.quickDayTitleActive,
              ]}
            >
              📅 Today
            </Text>
            <Text
              style={[
                styles.quickDaySubtitle,
                selectedDate === todayStr && styles.quickDaySubtitleActive,
              ]}
            >
              {formatFriendlyDate(todayStr)}
            </Text>
          </View>
          <View
            style={[
              styles.quickDayCountBadge,
              selectedDate === todayStr && styles.quickDayCountBadgeActive,
            ]}
          >
            <Text
              style={[
                styles.quickDayCountText,
                selectedDate === todayStr && styles.quickDayCountTextActive,
              ]}
            >
              {(tasksByLocalDate[todayStr] || []).length} tasks
            </Text>
          </View>
        </Pressable>

        <Pressable
          style={[
            styles.quickDayBtn,
            selectedDate === tomorrowStr && styles.quickDayBtnActive,
          ]}
          onPress={selectTomorrow}
          accessibilityLabel="Quick View Tomorrow's Tasks"
        >
          <View style={styles.quickDayBtnLeft}>
            <Text
              style={[
                styles.quickDayTitle,
                selectedDate === tomorrowStr && styles.quickDayTitleActive,
              ]}
            >
              ☀️ Tomorrow
            </Text>
            <Text
              style={[
                styles.quickDaySubtitle,
                selectedDate === tomorrowStr && styles.quickDaySubtitleActive,
              ]}
            >
              {formatFriendlyDate(tomorrowStr)}
            </Text>
          </View>
          <View
            style={[
              styles.quickDayCountBadge,
              selectedDate === tomorrowStr && styles.quickDayCountBadgeActive,
            ]}
          >
            <Text
              style={[
                styles.quickDayCountText,
                selectedDate === tomorrowStr && styles.quickDayCountTextActive,
              ]}
            >
              {(tasksByLocalDate[tomorrowStr] || []).length} tasks
            </Text>
          </View>
        </Pressable>
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
          <Pressable style={styles.rangeClearBtn} onPress={clearRange}>
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
            const isRangeEndpoint = cell.dateStr === rangeStart || cell.dateStr === rangeEnd;

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

        {/* Legend */}
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

      {/* Calendar Sub-tabs */}
      <View style={styles.sectionTabs}>
        <Pressable
          style={[styles.sectionTabBtn, subTab === 'day' && styles.sectionTabBtnActive]}
          onPress={() => setSubTab('day')}
        >
          <Text style={[styles.sectionTabBtnText, subTab === 'day' && styles.sectionTabBtnTextActive]}>
            Day Events ({selectedDateTasks.length})
          </Text>
        </Pressable>

        <Pressable
          style={[styles.sectionTabBtn, subTab === 'range' && styles.sectionTabBtnActive]}
          onPress={() => setSubTab('range')}
        >
          <Text style={[styles.sectionTabBtnText, subTab === 'range' && styles.sectionTabBtnTextActive]}>
            Range Agenda {activeRangeDays.length > 0 ? `(${activeRangeDays.length}D)` : ''}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.sectionTabBtn, subTab === 'tracker' && styles.sectionTabBtnActive]}
          onPress={() => setSubTab('tracker')}
        >
          <Text style={[styles.sectionTabBtnText, subTab === 'tracker' && styles.sectionTabBtnTextActive]}>
            Weekly 8D Tracker
          </Text>
        </Pressable>
      </View>

      {/* SUB-TAB 1: Selected Day Events */}
      {subTab === 'day' && (
        <View style={styles.subContentSection}>
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
              onPress={() => onOpenCreateTask(selectedDate)}
            >
              <Text style={styles.addEventBtnText}>+ Add Task</Text>
            </Pressable>
          </View>

          {/* List of Tasks for Selected Date */}
          {selectedDateTasks.length === 0 ? (
            <View style={styles.emptyDayCard}>
              <Text style={styles.emptyDayEmoji}>📅</Text>
              <Text style={styles.emptyDayTitle}>No tasks scheduled for this day</Text>
              <Text style={styles.emptyDaySubtitle}>
                Tap "+ Add Task" above to assign an inventory task or delivery to {selectedDate}.
              </Text>
            </View>
          ) : (
            <View style={styles.eventsList}>
              {selectedDateTasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  isReminderActive={reminderTaskIds.has(task.id)}
                  isDeleting={deletingTaskId === task.id}
                  onToggleComplete={onToggleComplete}
                  onToggleReminder={onToggleReminder}
                  onEdit={onEditTask}
                  onDelete={onDeleteTask}
                />
              ))}
            </View>
          )}
        </View>
      )}

      {/* SUB-TAB 2: Range Agenda */}
      {subTab === 'range' && (
        <View style={styles.subContentSection}>
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
                onPress={() => onOpenCreateAcrossRange(rangeStart || selectedDate)}
              >
                <Text style={styles.scheduleAcrossRangeBtnText}>
                  + Schedule Task Across Selected Range
                </Text>
              </Pressable>
            )}
          </View>

          {activeRangeDays.map(dateStr => {
            const dayTasks = tasksByLocalDate[dateStr] || [];
            const completed = dayTasks.filter(t => t.is_completed).length;
            const total = dayTasks.length;
            const percent = total > 0 ? Math.round((completed / total) * 100) : null;

            return (
              <Pressable
                key={dateStr}
                style={[
                  styles.agendaDayCard,
                  dateStr === selectedDate && styles.agendaDayCardSelected,
                ]}
                onPress={() => {
                  onSelectDate(dateStr);
                  setSubTab('day');
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

                <View style={styles.agendaTasksSnippet}>
                  {dayTasks.slice(0, 3).map(task => (
                    <Text
                      key={task.id}
                      style={[
                        styles.agendaTaskSnippetText,
                        task.is_completed && styles.agendaTaskSnippetTextCompleted,
                      ]}
                      numberOfLines={1}
                    >
                      {task.is_completed ? '✓ ' : '• '}
                      {task.title}
                    </Text>
                  ))}
                  {dayTasks.length > 3 && (
                    <Text style={styles.agendaMoreText}>
                      +{dayTasks.length - 3} more tasks
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* SUB-TAB 3: Weekly 8D Tracker */}
      {subTab === 'tracker' && (
        <View style={styles.subContentSection}>
          <View style={styles.trackerSummaryCard}>
            <Text style={styles.trackerSummaryTitle}>📅 8-Day Rolling Workload Tracker</Text>
            <Text style={styles.trackerSummarySubtitle}>
              Continuous forward view from today showing task volumes and daily progress.
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
                onSelectDate(dayItem.dateStr);
                setSubTab('day');
              }}
            >
              <View style={styles.trackerDayTopRow}>
                <View style={styles.trackerDayLeft}>
                  <Text
                    style={[
                      styles.trackerDayName,
                      dayItem.isToday && styles.trackerDayNameToday,
                    ]}
                  >
                    {dayItem.dayName.toUpperCase()}{' '}
                    {dayItem.isToday ? '(TODAY)' : ''}
                  </Text>
                  <Text style={styles.trackerDayDate}>{dayItem.displayDate}</Text>
                </View>

                <View style={styles.trackerDayRight}>
                  <Text style={styles.trackerCountsText}>
                    {dayItem.total === 0
                      ? 'No tasks'
                      : `${dayItem.completed}/${dayItem.total} done (${dayItem.percent}%)`}
                  </Text>
                </View>
              </View>

              {dayItem.total > 0 && dayItem.percent !== null && (
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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  monthNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  monthNavBtn: {
    padding: 6,
  },
  monthNavBtnText: {
    fontSize: 16,
    color: '#4263EB',
    fontWeight: '700',
  },
  monthTitleText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  quickDaySwitcherBar: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  quickDayBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quickDayBtnActive: {
    borderColor: '#4263EB',
    backgroundColor: '#EEF2FF',
  },
  quickDayBtnLeft: {
    flex: 1,
  },
  quickDayTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  quickDayTitleActive: {
    color: '#4263EB',
  },
  quickDaySubtitle: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 1,
  },
  quickDaySubtitleActive: {
    color: '#4338CA',
  },
  quickDayCountBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  quickDayCountBadgeActive: {
    backgroundColor: '#DBEAFE',
  },
  quickDayCountText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  quickDayCountTextActive: {
    color: '#1D4ED8',
  },
  rangeBanner: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#93C5FD',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rangeBannerTextWrap: {
    flex: 1,
    marginRight: 8,
  },
  rangeBannerTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  rangeBannerSubtitle: {
    fontSize: 10,
    color: '#3B82F6',
    marginTop: 2,
  },
  rangeClearBtn: {
    backgroundColor: '#DBEAFE',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  rangeClearBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  calendarCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  weekDaysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  weekDayText: {
    width: '14.28%',
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.28%',
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
    marginBottom: 3,
  },
  dayCellOutside: {
    opacity: 0.35,
  },
  dayCellToday: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
    borderWidth: 1,
  },
  dayCellInRange: {
    backgroundColor: '#EEF2FF',
  },
  dayCellRangeEndpoint: {
    backgroundColor: '#C7D2FE',
  },
  dayCellSelected: {
    backgroundColor: '#4263EB',
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
  },
  taskCountBadge: {
    backgroundColor: '#4263EB',
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 1,
    minWidth: 12,
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
    fontSize: 8,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
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
    fontSize: 10,
    color: '#64748B',
  },
  sectionTabs: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 8,
    padding: 2,
    marginBottom: 10,
  },
  sectionTabBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 6,
  },
  sectionTabBtnActive: {
    backgroundColor: '#FFFFFF',
  },
  sectionTabBtnText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  sectionTabBtnTextActive: {
    color: '#1E293B',
    fontWeight: '700',
  },
  subContentSection: {
    gap: 10,
  },
  dayHeaderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dayHeaderInfo: {
    flex: 1,
  },
  dayHeaderTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
  },
  dayHeaderMetrics: {
    fontSize: 11,
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
    fontSize: 12,
    fontWeight: '700',
  },
  emptyDayCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  emptyDayEmoji: {
    fontSize: 32,
    marginBottom: 6,
  },
  emptyDayTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
  },
  emptyDaySubtitle: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 4,
    maxWidth: 280,
  },
  eventsList: {
    gap: 8,
  },
  rangeSummaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  rangeSummaryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  rangeSummaryDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    marginBottom: 6,
  },
  scheduleAcrossRangeBtn: {
    backgroundColor: '#4263EB',
    paddingVertical: 7,
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
  },
  agendaDayCardSelected: {
    borderColor: '#4263EB',
  },
  agendaDayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  agendaDayTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  agendaDayMetricText: {
    fontSize: 11,
    color: '#64748B',
  },
  progressBarTrack: {
    height: 5,
    backgroundColor: '#E2E8F0',
    borderRadius: 2.5,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 2.5,
  },
  agendaTasksSnippet: {
    gap: 3,
  },
  agendaTaskSnippetText: {
    fontSize: 11,
    color: '#334155',
  },
  agendaTaskSnippetTextCompleted: {
    textDecorationLine: 'line-through',
    color: '#94A3B8',
  },
  agendaMoreText: {
    fontSize: 10,
    color: '#64748B',
    fontStyle: 'italic',
  },
  trackerSummaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  trackerSummaryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  trackerSummarySubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  trackerDayCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  trackerDayCardToday: {
    borderLeftWidth: 4,
    borderLeftColor: '#4263EB',
  },
  trackerDayCardSelected: {
    borderColor: '#4263EB',
  },
  trackerDayTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  trackerDayLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  trackerDayName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
  },
  trackerDayNameToday: {
    color: '#4263EB',
  },
  trackerDayDate: {
    fontSize: 11,
    color: '#64748B',
  },
  trackerDayRight: {},
  trackerCountsText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  trackerUpcomingText: {
    fontSize: 11,
    color: '#334155',
    marginTop: 4,
  },
  trackerJournalText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 4,
    fontStyle: 'italic',
  },
});
