import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/config/app_theme.dart';
import '../../models/task.dart';
import '../../models/daily_progress.dart';
import '../../services/task_repository.dart';
import '../widgets/task_card.dart';
import '../widgets/task_edit_dialog.dart';
import '../../../../shared/widgets/empty_state_view.dart';

class CalendarViewScreen extends StatefulWidget {
  final TaskRepository taskRepository;

  const CalendarViewScreen({
    super.key,
    required this.taskRepository,
  });

  @override
  State<CalendarViewScreen> createState() => _CalendarViewScreenState();
}

class _CalendarViewScreenState extends State<CalendarViewScreen> {
  DateTime _selectedDate = DateTime.now();
  List<Task> _allTasks = [];
  DailyProgress? _selectedDayProgress;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    final tasks = await widget.taskRepository.getLocalTasks();
    final dateStr = DateFormat('yyyy-MM-dd').format(_selectedDate);
    final progress = await widget.taskRepository.getDailyProgress(dateStr);

    if (mounted) {
      setState(() {
        _allTasks = tasks;
        _selectedDayProgress = progress;
        _isLoading = false;
      });
    }
  }

  List<Task> get _tasksForSelectedDate {
    final selStr = DateFormat('yyyy-MM-dd').format(_selectedDate);
    return _allTasks.where((t) {
      final s = t.localDateString;
      return s == selStr;
    }).toList();
  }

  Future<void> _pickMonthDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
    );
    if (picked != null) {
      setState(() => _selectedDate = picked);
      _loadData();
    }
  }

  void _onDaySelected(DateTime date) {
    setState(() => _selectedDate = date);
    _loadData();
  }

  Future<void> _toggleTask(Task task, bool completed) async {
    await widget.taskRepository.toggleTaskCompletion(task.id, completed);
    _loadData();
  }

  Future<void> _openEdit(Task task) async {
    final updated = await showDialog<Task>(
      context: context,
      builder: (ctx) => TaskEditDialog(task: task),
    );
    if (updated != null) {
      await widget.taskRepository.updateTask(updated);
      _loadData();
    }
  }

  Future<void> _deleteTask(Task task) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Task'),
        content: Text('Are you sure you want to delete "${task.title}"?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirm == true) {
      await widget.taskRepository.deleteTask(task.id);
      _loadData();
    }
  }

  Future<void> _addNewTask() async {
    final newTask = await showDialog<Task>(
      context: context,
      builder: (ctx) => TaskEditDialog(initialDate: _selectedDate),
    );
    if (newTask != null) {
      await widget.taskRepository.createTask(newTask);
      _loadData();
    }
  }

  Future<void> _editJournalNotes() async {
    final controller = TextEditingController(text: _selectedDayProgress?.journalNotes ?? '');
    final dateStr = DateFormat('yyyy-MM-dd').format(_selectedDate);

    final saved = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Daily Journal ($dateStr)'),
        content: TextField(
          controller: controller,
          maxLines: 5,
          decoration: const InputDecoration(
            hintText: 'Record daily notes, accomplishments, and thoughts...',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Save Log'),
          ),
        ],
      ),
    );

    if (saved != null) {
      await widget.taskRepository.saveDailyProgress(dateStr, journalNotes: saved);
      _loadData();
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final dayTasks = _tasksForSelectedDate;
    final doneCount = dayTasks.where((t) => t.isDone).length;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Task Calendar'),
        actions: [
          IconButton(
            icon: const Icon(Icons.calendar_month_rounded),
            tooltip: 'Pick date',
            onPressed: _pickMonthDate,
          ),
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh',
            onPressed: _loadData,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _addNewTask,
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        child: const Icon(Icons.add),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                // Horizontal 14-day strip around selected date
                _buildDateStrip(isDark),

                // Journal Notes Bar
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              DateFormat('EEEE, MMMM d, yyyy').format(_selectedDate),
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: isDark ? AppColors.darkText : AppColors.lightText,
                              ),
                            ),
                            Text(
                              '${dayTasks.length} tasks ($doneCount completed)',
                              style: TextStyle(
                                fontSize: 12,
                                color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.note_alt_outlined, color: AppColors.primary),
                        tooltip: 'Edit daily journal',
                        onPressed: _editJournalNotes,
                      ),
                    ],
                  ),
                ),

                if (_selectedDayProgress?.journalNotes.isNotEmpty == true)
                  Container(
                    margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.primary.withOpacity(0.08),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.primary.withOpacity(0.2)),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.format_quote_rounded, size: 18, color: AppColors.primary),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _selectedDayProgress!.journalNotes,
                            style: TextStyle(
                              fontSize: 13,
                              fontStyle: FontStyle.italic,
                              color: isDark ? AppColors.darkText : AppColors.lightText,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),

                // Tasks list
                Expanded(
                  child: dayTasks.isEmpty
                      ? EmptyStateView(
                          title: 'No Tasks For This Day',
                          message: 'Tap the + button to schedule a task for ${DateFormat('MMM d').format(_selectedDate)}.',
                          icon: Icons.event_available_outlined,
                          actionLabel: 'Add Task',
                          onAction: _addNewTask,
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.only(bottom: 80, top: 8),
                          itemCount: dayTasks.length,
                          itemBuilder: (context, index) {
                            final task = dayTasks[index];
                            return TaskCard(
                              task: task,
                              onToggleComplete: (val) => _toggleTask(task, val),
                              onTap: () => _openEdit(task),
                              onEdit: () => _openEdit(task),
                              onDelete: () => _deleteTask(task),
                            );
                          },
                        ),
                ),
              ],
            ),
    );
  }

  Widget _buildDateStrip(bool isDark) {
    // Show 7 days before and 7 days after selected date
    final startDay = _selectedDate.subtract(const Duration(days: 3));
    final days = List.generate(7, (i) => startDay.add(Duration(days: i)));

    return Container(
      height: 85,
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: isDark ? AppColors.darkSurface : AppColors.lightSurface,
        border: Border(
          bottom: BorderSide(color: isDark ? AppColors.darkBorder : AppColors.lightBorder),
        ),
      ),
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        itemCount: days.length,
        itemBuilder: (context, index) {
          final day = days[index];
          final isSelected = day.year == _selectedDate.year &&
              day.month == _selectedDate.month &&
              day.day == _selectedDate.day;
          final isToday = day.year == DateTime.now().year &&
              day.month == DateTime.now().month &&
              day.day == DateTime.now().day;

          final dayStr = DateFormat('yyyy-MM-dd').format(day);
          final hasTasks = _allTasks.any((t) => t.localDateString == dayStr);

          return GestureDetector(
            onTap: () => _onDaySelected(day),
            child: Container(
              width: 58,
              margin: const EdgeInsets.symmetric(horizontal: 4),
              decoration: BoxDecoration(
                color: isSelected
                    ? AppColors.primary
                    : (isToday ? AppColors.primary.withOpacity(0.12) : Colors.transparent),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: isSelected
                      ? AppColors.primary
                      : (isToday
                          ? AppColors.primary.withOpacity(0.4)
                          : (isDark ? AppColors.darkBorder : AppColors.lightBorder)),
                ),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    DateFormat('E').format(day).toUpperCase(),
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: isSelected
                          ? Colors.white
                          : (isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${day.day}',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: isSelected
                          ? Colors.white
                          : (isDark ? AppColors.darkText : AppColors.lightText),
                    ),
                  ),
                  if (hasTasks) ...[
                    const SizedBox(height: 2),
                    Container(
                      width: 5,
                      height: 5,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: isSelected ? Colors.white : AppColors.primary,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
