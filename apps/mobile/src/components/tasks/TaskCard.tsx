import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Task } from './types';
import { formatScheduledDisplay } from '@/utils/timezone';

interface TaskCardProps {
  task: Task;
  isReminderActive: boolean;
  isDeleting?: boolean;
  onToggleComplete: (task: Task) => void;
  onToggleReminder: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  isReminderActive,
  isDeleting = false,
  onToggleComplete,
  onToggleReminder,
  onEdit,
  onDelete,
}) => {
  const { label: dateLabel, isOverdue } = formatScheduledDisplay(task.scheduled_at);

  return (
    <View
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
          onPress={() => onToggleComplete(task)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: task.is_completed }}
          accessibilityLabel={task.is_completed ? `Mark ${task.title} as pending` : `Mark ${task.title} as completed`}
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

          {/* Daily Progress Journal Note */}
          {Boolean(task.journal_entry || task.notes || task.description) && (
            <View style={styles.journalBox}>
              <Text style={styles.journalIcon}>📝</Text>
              <Text
                style={[
                  styles.journalText,
                  task.is_completed && styles.journalTextCompleted,
                ]}
                numberOfLines={2}
              >
                {task.journal_entry || task.notes || task.description}
              </Text>
            </View>
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
                {(task.priority || 'medium').toUpperCase()}
              </Text>
            </View>

            {/* Scheduled Date & Time */}
            {Boolean(task.scheduled_at) && (
              <Text
                style={[
                  styles.dateText,
                  isOverdue && !task.is_completed && styles.dateTextOverdue,
                  task.is_completed && styles.dateTextCompleted,
                ]}
              >
                {isOverdue && !task.is_completed ? '⚠️ ' : '⏰ '}
                {dateLabel}
              </Text>
            )}

            {/* Reminder Badge / Action */}
            {!task.is_completed && isReminderActive && (
              <Pressable
                style={styles.reminderBadgeActive}
                onPress={() => onToggleReminder(task)}
                accessibilityLabel="Reminder active. Tap to cancel."
              >
                <Text style={styles.reminderTextActive}>🔔 Alert Active</Text>
              </Pressable>
            )}

            {!task.is_completed && !isReminderActive && !isOverdue && Boolean(task.scheduled_at) && (
              <Pressable
                style={styles.reminderBadgeInactive}
                onPress={() => onToggleReminder(task)}
                accessibilityLabel="Set local reminder"
              >
                <Text style={styles.reminderTextInactive}>+ 🔔 Set Alert</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Action Column */}
        <View style={styles.actionColumn}>
          <Pressable
            style={styles.editButton}
            onPress={() => onEdit(task)}
            accessibilityLabel={`Edit ${task.title}`}
          >
            <Text style={styles.editButtonText}>Edit</Text>
          </Pressable>

          <Pressable
            style={[
              styles.deleteButton,
              isDeleting && { opacity: 0.5 },
            ]}
            disabled={isDeleting}
            onPress={() => onDelete(task)}
            accessibilityLabel={`Delete ${task.title}`}
          >
            <Text style={styles.deleteButtonText}>✕</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  taskCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
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
  journalBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginTop: 4,
    gap: 6,
  },
  journalIcon: {
    fontSize: 11,
    marginTop: 1,
  },
  journalText: {
    flex: 1,
    fontSize: 12,
    color: '#334155',
    lineHeight: 16,
  },
  journalTextCompleted: {
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
});
