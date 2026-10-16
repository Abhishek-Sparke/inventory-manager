import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/config/app_theme.dart';
import '../../models/task.dart';

class TaskEditDialog extends StatefulWidget {
  final Task? task;
  final DateTime? initialDate;

  const TaskEditDialog({
    super.key,
    this.task,
    this.initialDate,
  });

  @override
  State<TaskEditDialog> createState() => _TaskEditDialogState();
}

class _TaskEditDialogState extends State<TaskEditDialog> {
  final _formKey = GlobalKey<FormState>();

  late TextEditingController _titleController;
  late TextEditingController _descController;
  late TextEditingController _notesController;

  late TaskPriority _priority;
  DateTime? _scheduledDateTime;
  int? _reminderMinutes;

  @override
  void initState() {
    super.initState();
    final t = widget.task;
    _titleController = TextEditingController(text: t?.title ?? '');
    _descController = TextEditingController(text: t?.description ?? '');
    _notesController = TextEditingController(text: t?.notes.isNotEmpty == true ? t!.notes : (t?.journalEntry ?? ''));
    _priority = t?.priority ?? TaskPriority.medium;

    if (t?.scheduledAt != null) {
      _scheduledDateTime = t!.localScheduledDateTime;
    } else if (widget.initialDate != null) {
      final now = DateTime.now();
      _scheduledDateTime = DateTime(
        widget.initialDate!.year,
        widget.initialDate!.month,
        widget.initialDate!.day,
        now.hour,
        now.minute,
      );
    } else {
      _scheduledDateTime = DateTime.now().add(const Duration(hours: 1));
    }

    _reminderMinutes = t?.reminderMinutes ?? 15;
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final pickedDate = await showDatePicker(
      context: context,
      initialDate: _scheduledDateTime ?? now,
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
    );

    if (pickedDate != null) {
      final initialTime = _scheduledDateTime != null
          ? TimeOfDay(hour: _scheduledDateTime!.hour, minute: _scheduledDateTime!.minute)
          : TimeOfDay.now();

      if (!mounted) return;
      final pickedTime = await showTimePicker(
        context: context,
        initialTime: initialTime,
      );

      setState(() {
        final time = pickedTime ?? initialTime;
        _scheduledDateTime = DateTime(
          pickedDate.year,
          pickedDate.month,
          pickedDate.day,
          time.hour,
          time.minute,
        );
      });
    }
  }

  void _submit() {
    if (!_formKey.currentState!.validate()) return;

    final String? isoUtc = _scheduledDateTime?.toUtc().toIso8601String();

    final task = (widget.task ?? const Task(id: 0, title: '')).copyWith(
      title: _titleController.text.trim(),
      description: _descController.text.trim(),
      scheduledAt: isoUtc,
      priority: _priority,
      notes: _notesController.text.trim(),
      journalEntry: _notesController.text.trim(),
      reminderMinutes: _reminderMinutes,
    );

    Navigator.of(context).pop(task);
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final isEditing = widget.task != null;

    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      backgroundColor: isDark ? AppColors.darkSurface : AppColors.lightBackground,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480, maxHeight: 680),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Form(
            key: _formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        isEditing ? 'Edit Task' : 'New Task',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: isDark ? AppColors.darkText : AppColors.lightText,
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close),
                        onPressed: () => Navigator.of(context).pop(),
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Title
                  TextFormField(
                    controller: _titleController,
                    decoration: const InputDecoration(
                      labelText: 'Task Title *',
                      prefixIcon: Icon(Icons.task_alt_rounded),
                    ),
                    validator: (v) => (v == null || v.trim().isEmpty) ? 'Please enter a title' : null,
                  ),
                  const SizedBox(height: 12),

                  // Description
                  TextFormField(
                    controller: _descController,
                    maxLines: 2,
                    decoration: const InputDecoration(
                      labelText: 'Description (Optional)',
                      prefixIcon: Icon(Icons.description_outlined),
                    ),
                  ),
                  const SizedBox(height: 12),

                  // Priority Selection
                  InputDecorator(
                    decoration: const InputDecoration(
                      labelText: 'Priority',
                      prefixIcon: Icon(Icons.flag_outlined),
                    ),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<TaskPriority>(
                        value: _priority,
                        isDense: true,
                        items: const [
                          DropdownMenuItem(
                            value: TaskPriority.low,
                            child: Row(
                              children: [
                                Icon(Icons.circle, color: AppColors.priorityLow, size: 12),
                                SizedBox(width: 8),
                                Text('Low Priority'),
                              ],
                            ),
                          ),
                          DropdownMenuItem(
                            value: TaskPriority.medium,
                            child: Row(
                              children: [
                                Icon(Icons.circle, color: AppColors.priorityMedium, size: 12),
                                SizedBox(width: 8),
                                Text('Medium Priority'),
                              ],
                            ),
                          ),
                          DropdownMenuItem(
                            value: TaskPriority.high,
                            child: Row(
                              children: [
                                Icon(Icons.circle, color: AppColors.priorityHigh, size: 12),
                                SizedBox(width: 8),
                                Text('High Priority'),
                              ],
                            ),
                          ),
                        ],
                        onChanged: (p) {
                          if (p != null) setState(() => _priority = p);
                        },
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),

                  // Date & Time Picker
                  InkWell(
                    onTap: _pickDate,
                    borderRadius: BorderRadius.circular(12),
                    child: InputDecorator(
                      decoration: const InputDecoration(
                        labelText: 'Scheduled Time',
                        prefixIcon: Icon(Icons.calendar_today_rounded),
                      ),
                      child: Text(
                        _scheduledDateTime != null
                            ? DateFormat('EEEE, MMM d, y - h:mm a').format(_scheduledDateTime!)
                            : 'Set date & time',
                        style: TextStyle(
                          fontSize: 14,
                          color: isDark ? AppColors.darkText : AppColors.lightText,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),

                  // Reminder offset
                  InputDecorator(
                    decoration: const InputDecoration(
                      labelText: 'Reminder Alert',
                      prefixIcon: Icon(Icons.notifications_active_outlined),
                    ),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<int?>(
                        value: _reminderMinutes,
                        isDense: true,
                        items: const [
                          DropdownMenuItem(value: null, child: Text('No reminder')),
                          DropdownMenuItem(value: 5, child: Text('5 minutes before')),
                          DropdownMenuItem(value: 15, child: Text('15 minutes before')),
                          DropdownMenuItem(value: 30, child: Text('30 minutes before')),
                          DropdownMenuItem(value: 60, child: Text('1 hour before')),
                          DropdownMenuItem(value: 1440, child: Text('1 day before')),
                        ],
                        onChanged: (val) => setState(() => _reminderMinutes = val),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),

                  // Notes / Journal
                  TextFormField(
                    controller: _notesController,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      labelText: 'Notes / Execution Journal',
                      prefixIcon: Icon(Icons.menu_book_outlined),
                    ),
                  ),
                  const SizedBox(height: 20),

                  ElevatedButton(
                    onPressed: _submit,
                    child: Text(isEditing ? 'Save Changes' : 'Create Task'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
