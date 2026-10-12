import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
  Pressable,
  Alert,
  Platform,
} from 'react-native';
import { Task, TaskPriority, TaskStatus } from './types';
import { getLocalDateString, formatLocalTime } from '@/utils/timezone';

export interface TaskSavePayload {
  title: string;
  description: string;
  journalEntry: string;
  date: string;
  startTime: string;
  endTime: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  notes: string;
  reminderEnabled: boolean;
  reminderOffset: number;
  scheduleAcrossRange: boolean;
}

interface TaskModalProps {
  visible: boolean;
  editingTask: Task | null;
  initialDate?: string;
  activeRangeDays?: string[];
  isReminderSet?: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: TaskSavePayload) => void;
}

export const TaskModal: React.FC<TaskModalProps> = ({
  visible,
  editingTask,
  initialDate,
  activeRangeDays = [],
  isReminderSet = false,
  saving,
  onClose,
  onSave,
}) => {
  const [title, setTitle] = useState('');
  const [journalEntry, setJournalEntry] = useState('');
  const [date, setDate] = useState(() => initialDate || getLocalDateString());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [hasEndTime, setHasEndTime] = useState(false);
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [notes, setNotes] = useState('');
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderOffset, setReminderOffset] = useState<number>(0);
  const [scheduleAcrossRange, setScheduleAcrossRange] = useState(false);

  // Sync state whenever modal opens or editingTask changes
  useEffect(() => {
    if (!visible) return;

    if (editingTask) {
      setTitle(editingTask.title);
      const existingJournal =
        editingTask.journal_entry ||
        editingTask.notes ||
        editingTask.description ||
        '';
      setJournalEntry(existingJournal);

      if (editingTask.scheduled_at) {
        const d = new Date(editingTask.scheduled_at);
        setDate(getLocalDateString(d));
        setStartTime(formatLocalTime(d));
      } else {
        setDate(initialDate || getLocalDateString());
        setStartTime('09:00');
      }

      if (editingTask.end_at) {
        const endD = new Date(editingTask.end_at);
        setEndTime(formatLocalTime(endD));
        setHasEndTime(true);
      } else {
        setEndTime('10:00');
        setHasEndTime(false);
      }

      setPriority(editingTask.priority || 'medium');
      setStatus(editingTask.status || (editingTask.is_completed ? 'completed' : 'pending'));
      setNotes(editingTask.notes || '');
      setReminderEnabled(isReminderSet);
      setReminderOffset(editingTask.reminder_minutes ?? 0);
      setScheduleAcrossRange(false);
    } else {
      // New task
      setTitle('');
      setJournalEntry('');
      setDate(initialDate || getLocalDateString());
      setStartTime('09:00');
      setEndTime('10:00');
      setHasEndTime(false);
      setPriority('medium');
      setStatus('pending');
      setNotes('');
      setReminderEnabled(true);
      setReminderOffset(0);
      setScheduleAcrossRange(false);
    }
  }, [visible, editingTask, initialDate, isReminderSet]);

  function handleSave() {
    if (!title.trim()) {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.alert) {
        window.alert('Please enter a task title.');
      } else {
        Alert.alert('Required Field', 'Please enter a task title.');
      }
      return;
    }

    const journalTrimmed = journalEntry.trim();
    onSave({
      title: title.trim(),
      description: journalTrimmed,
      journalEntry: journalTrimmed,
      date: date.trim(),
      startTime: startTime.trim(),
      endTime: hasEndTime ? endTime.trim() : null,
      priority,
      status,
      notes: notes.trim() || journalTrimmed,
      reminderEnabled,
      reminderOffset,
      scheduleAcrossRange,
    });
  }

  function setDatePreset(daysFromNow: number) {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    setDate(getLocalDateString(d));
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {editingTask ? 'Edit Task / Event' : 'Add New Task'}
            </Text>
            <Pressable
              style={styles.modalCloseBtn}
              onPress={onClose}
              accessibilityLabel="Close modal"
            >
              <Text style={styles.modalCloseBtnText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
            {/* Title */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Title *</Text>
              <TextInput
                style={styles.formInput}
                placeholder="e.g. Cold storage temperature check, Pallet audit..."
                placeholderTextColor="#94A3B8"
                value={title}
                onChangeText={setTitle}
              />
            </View>

            {/* Daily Progress Journal Section */}
            <View style={styles.journalSectionCard}>
              <View style={styles.journalSectionHeader}>
                <Text style={styles.journalSectionIcon}>📝</Text>
                <View style={styles.journalTitleCol}>
                  <Text style={styles.journalSectionTitle}>Daily Progress Journal</Text>
                  <Text style={styles.journalSectionSubtitle}>
                    Log task assignment progress and accomplishments for this day
                  </Text>
                </View>
              </View>
              <TextInput
                style={[styles.formInput, styles.journalTextArea]}
                placeholder="e.g. Conducted stock audit of 50 SKUs, reconciled cooler inventory, verified counts..."
                placeholderTextColor="#94A3B8"
                value={journalEntry}
                onChangeText={setJournalEntry}
                multiline
                numberOfLines={3}
              />
            </View>

            {/* Date with quick presets */}
            <View style={styles.formGroup}>
              <View style={styles.labelRowWithPresets}>
                <Text style={styles.formLabel}>Date (YYYY-MM-DD)</Text>
                <View style={styles.quickPresetsRow}>
                  <Pressable style={styles.presetChip} onPress={() => setDatePreset(0)}>
                    <Text style={styles.presetChipText}>Today</Text>
                  </Pressable>
                  <Pressable style={styles.presetChip} onPress={() => setDatePreset(1)}>
                    <Text style={styles.presetChipText}>Tomorrow</Text>
                  </Pressable>
                  <Pressable style={styles.presetChip} onPress={() => setDatePreset(7)}>
                    <Text style={styles.presetChipText}>+7 Days</Text>
                  </Pressable>
                </View>
              </View>
              <TextInput
                style={styles.formInput}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94A3B8"
                value={date}
                onChangeText={setDate}
              />
            </View>

            {/* Start Time & Presets */}
            <View style={styles.formGroup}>
              <View style={styles.labelRowWithPresets}>
                <Text style={styles.formLabel}>Start Time (e.g. 09:00 or 5:48 PM)</Text>
                <View style={styles.quickPresetsRow}>
                  <Pressable style={styles.presetChip} onPress={() => setStartTime('09:00')}>
                    <Text style={styles.presetChipText}>09:00</Text>
                  </Pressable>
                  <Pressable style={styles.presetChip} onPress={() => setStartTime('14:00')}>
                    <Text style={styles.presetChipText}>14:00</Text>
                  </Pressable>
                  <Pressable style={styles.presetChip} onPress={() => setStartTime('5:48 PM')}>
                    <Text style={styles.presetChipText}>5:48 PM</Text>
                  </Pressable>
                </View>
              </View>
              <TextInput
                style={styles.formInput}
                placeholder="09:00 or 5:48 PM"
                placeholderTextColor="#94A3B8"
                value={startTime}
                onChangeText={setStartTime}
              />
            </View>

            {/* End Time Toggle & Input */}
            <View style={styles.formGroup}>
              <Pressable
                style={styles.checkboxRow}
                onPress={() => setHasEndTime(!hasEndTime)}
              >
                <View style={[styles.checkboxSmall, hasEndTime && styles.checkboxSmallChecked]}>
                  {hasEndTime && <Text style={styles.checkboxSmallCheck}>✓</Text>}
                </View>
                <Text style={styles.checkboxRowLabel}>Set Optional End Time</Text>
              </Pressable>

              {hasEndTime && (
                <TextInput
                  style={[styles.formInput, { marginTop: 6 }]}
                  placeholder="10:00 or 6:30 PM"
                  placeholderTextColor="#94A3B8"
                  value={endTime}
                  onChangeText={setEndTime}
                />
              )}
            </View>

            {/* Multi-date Option if activeRangeDays is available and creating */}
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
                    Schedule across all {activeRangeDays.length} days in selected calendar range
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
                      priority === p && styles.selectorOptionActive,
                    ]}
                    onPress={() => setPriority(p)}
                  >
                    <Text
                      style={[
                        styles.selectorOptionText,
                        priority === p && styles.selectorOptionTextActive,
                      ]}
                    >
                      {p.toUpperCase()}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Completion Status Selector */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Completion Status</Text>
              <View style={styles.selectorRow}>
                {(['pending', 'in_progress', 'completed'] as const).map(st => (
                  <Pressable
                    key={st}
                    style={[
                      styles.selectorOption,
                      status === st && styles.selectorOptionActive,
                    ]}
                    onPress={() => setStatus(st)}
                  >
                    <Text
                      style={[
                        styles.selectorOptionText,
                        status === st && styles.selectorOptionTextActive,
                      ]}
                    >
                      {st.replace('_', ' ').toUpperCase()}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Notes */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Progress Updates & Notes</Text>
              <TextInput
                style={[styles.formInput, styles.formTextArea]}
                placeholder="Optional notes, verification results, or observations"
                placeholderTextColor="#94A3B8"
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={2}
              />
            </View>

            {/* Reminder Settings */}
            <View style={styles.reminderCard}>
              <Pressable
                style={styles.checkboxRow}
                onPress={() => setReminderEnabled(!reminderEnabled)}
              >
                <View
                  style={[
                    styles.checkboxSmall,
                    reminderEnabled && styles.checkboxSmallChecked,
                  ]}
                >
                  {reminderEnabled && <Text style={styles.checkboxSmallCheck}>✓</Text>}
                </View>
                <Text style={styles.checkboxRowLabel}>
                  🔔 Enable local device notification reminder
                </Text>
              </Pressable>

              {reminderEnabled && (
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
                        reminderOffset === item.val && styles.offsetPillActive,
                      ]}
                      onPress={() => setReminderOffset(item.val)}
                    >
                      <Text
                        style={[
                          styles.offsetPillText,
                          reminderOffset === item.val && styles.offsetPillTextActive,
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

          {/* Footer */}
          <View style={styles.modalFooter}>
            <Pressable style={styles.modalCancelBtn} onPress={onClose}>
              <Text style={styles.modalCancelBtnText}>Cancel</Text>
            </Pressable>

            <Pressable
              style={[styles.modalSaveBtn, saving && { opacity: 0.7 }]}
              disabled={saving}
              onPress={handleSave}
            >
              <Text style={styles.modalSaveBtnText}>
                {saving ? 'Saving...' : editingTask ? 'Update Task' : 'Save Task'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 8,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
  },
  modalCloseBtn: {
    padding: 6,
  },
  modalCloseBtnText: {
    fontSize: 16,
    color: '#64748B',
    fontWeight: '700',
  },
  modalScroll: {
    padding: 16,
  },
  formGroup: {
    marginBottom: 12,
  },
  formLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 4,
  },
  labelRowWithPresets: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  quickPresetsRow: {
    flexDirection: 'row',
    gap: 4,
  },
  presetChip: {
    backgroundColor: '#EEF2FF',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  presetChipText: {
    fontSize: 10,
    color: '#4263EB',
    fontWeight: '600',
  },
  formInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#1E293B',
  },
  formTextArea: {
    minHeight: 52,
    textAlignVertical: 'top',
  },
  journalSectionCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  journalSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  journalSectionIcon: {
    fontSize: 16,
  },
  journalTitleCol: {
    flex: 1,
  },
  journalSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
  },
  journalSectionSubtitle: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 1,
  },
  journalTextArea: {
    backgroundColor: '#FFFFFF',
    minHeight: 64,
    textAlignVertical: 'top',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
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
    fontSize: 10,
    fontWeight: '800',
  },
  checkboxRowLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  selectorRow: {
    flexDirection: 'row',
    gap: 6,
  },
  selectorOption: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  selectorOptionActive: {
    backgroundColor: '#4263EB',
    borderColor: '#4263EB',
  },
  selectorOptionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  selectorOptionTextActive: {
    color: '#FFFFFF',
  },
  reminderCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 4,
    marginBottom: 8,
  },
  reminderOffsetsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  offsetPill: {
    flex: 1,
    paddingVertical: 5,
    alignItems: 'center',
    borderRadius: 4,
    backgroundColor: '#E2E8F0',
  },
  offsetPillActive: {
    backgroundColor: '#4263EB',
  },
  offsetPillText: {
    fontSize: 10,
    color: '#475569',
    fontWeight: '600',
  },
  offsetPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  modalCancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: '#E2E8F0',
  },
  modalCancelBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  modalSaveBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: '#4263EB',
  },
  modalSaveBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
