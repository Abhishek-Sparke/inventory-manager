import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface TaskProgressCardProps {
  totalTasks: number;
  totalCompleted: number;
  overallPercent: number;
  todayTotal: number;
  todayCompleted: number;
  todayPercent: number;
  weekTotal: number;
  weekCompleted: number;
  weekPercent: number;
  pendingCount: number;
  overdueCount: number;
  dueTodayIncomplete: number;
  dueUpcomingIncomplete: number;
}

export const TaskProgressCard: React.FC<TaskProgressCardProps> = ({
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
  dueTodayIncomplete,
  dueUpcomingIncomplete,
}) => {
  return (
    <View style={styles.container}>
      {/* Daily Task Progress Header */}
      <View style={styles.progressCard}>
        <View style={styles.progressHeader}>
          <View style={styles.progressTitleCol}>
            <Text style={styles.progressSectionTitle}>Daily Task Progress</Text>
            <Text style={styles.progressSectionSubtitle}>
              {todayTotal === 0
                ? 'No tasks scheduled for today'
                : `${todayCompleted} of ${todayTotal} task${todayTotal === 1 ? '' : 's'} completed today`}
            </Text>
          </View>
          <View
            style={[
              styles.overallPercentBadge,
              todayPercent === 100 && todayTotal > 0 && styles.overallPercentBadgeComplete,
            ]}
          >
            <Text
              style={[
                styles.overallPercentText,
                todayPercent === 100 && todayTotal > 0 && styles.overallPercentTextComplete,
              ]}
            >
              {todayPercent}%
            </Text>
          </View>
        </View>

        {/* Daily Progress Bar */}
        <View style={styles.progressBarTrack}>
          <View
            style={[
              styles.progressBarFill,
              {
                width: `${Math.min(100, Math.max(0, todayPercent))}%`,
                backgroundColor: todayPercent === 100 && todayTotal > 0 ? '#059669' : '#4263EB',
              },
            ]}
          />
        </View>

        {/* Breakdown Progress Bars */}
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
                    backgroundColor: todayPercent === 100 && todayTotal > 0 ? '#059669' : '#4263EB',
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
                <Text style={styles.progressRowLabel}>This Week's Workload</Text>
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
                    backgroundColor: weekPercent === 100 && weekTotal > 0 ? '#059669' : '#0284C7',
                  },
                ]}
              />
            </View>
          </View>

          {/* All Workspace Tasks */}
          <View style={styles.progressRow}>
            <View style={styles.progressRowHeader}>
              <View style={styles.progressRowTitleWrap}>
                <Text style={styles.progressRowDotAll}>●</Text>
                <Text style={styles.progressRowLabel}>All Workspace Tasks</Text>
              </View>
              <Text style={styles.progressRowCount}>
                {totalCompleted}/{totalTasks} ({overallPercent}%)
              </Text>
            </View>
            <View style={styles.miniProgressBarTrack}>
              <View
                style={[
                  styles.miniProgressBarFill,
                  {
                    width: `${Math.min(100, Math.max(0, overallPercent))}%`,
                    backgroundColor: overallPercent === 100 && totalTasks > 0 ? '#059669' : '#64748B',
                  },
                ]}
              />
            </View>
          </View>
        </View>

        {/* Status Pills */}
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

      {/* Overview Metric Cards Grid */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Due Today</Text>
          <Text style={[styles.statValue, { color: '#4263EB' }]}>
            {dueTodayIncomplete}
          </Text>
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Next 7 Days</Text>
          <Text style={[styles.statValue, { color: '#0284C7' }]}>
            {dueUpcomingIncomplete}
          </Text>
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Total Tasks</Text>
          <Text style={styles.statValue}>{totalTasks}</Text>
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Completed</Text>
          <Text style={[styles.statValue, { color: '#059669' }]}>
            {totalCompleted}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 4,
  },
  progressCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 10,
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
  progressRowDotAll: {
    color: '#64748B',
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
    color: '#1E293B',
    marginTop: 1,
  },
  statsGrid: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 10,
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statLabel: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '600',
  },
  statValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E293B',
    marginTop: 2,
  },
});
