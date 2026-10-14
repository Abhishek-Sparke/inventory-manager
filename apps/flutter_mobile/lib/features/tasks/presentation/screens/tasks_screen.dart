import 'package:flutter/material.dart';
import '../../../../core/config/app_theme.dart';
import '../../models/task.dart';
import '../../models/daily_progress.dart';
import '../../services/task_repository.dart';
import '../widgets/daily_progress_banner.dart';
import '../widgets/task_card.dart';
import '../widgets/task_edit_dialog.dart';
import '../../../../shared/widgets/empty_state_view.dart';
import '../../../../shared/widgets/offline_banner.dart';
import '../../../../core/network/network_info.dart';

enum TaskTabFilter { today, upcoming, all, completed }

class TasksScreen extends StatefulWidget {
  final TaskRepository taskRepository;
  final NetworkInfo networkInfo;

  const TasksScreen({
    super.key,
    required this.taskRepository,
    required this.networkInfo,
  });

  @override
  State<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends State<TasksScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<Task> _tasks = [];
  DailyProgress? _todayProgress;
  bool _isLoading = true;
  bool _isOffline = false;
  int _pendingSyncCount = 0;
  String _searchQuery = '';
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _tabController.addListener(() {
      if (mounted) setState(() {});
    });
    _initConnectivityListener();
    _loadData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  void _initConnectivityListener() {
    widget.networkInfo.onConnectivityChanged.listen((connected) {
      if (mounted) {
        setState(() => _isOffline = !connected);
        if (connected) {
          _loadData();
        }
      }
    });
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    final connected = await widget.networkInfo.isConnected;
    _isOffline = !connected;

    final tasks = await widget.taskRepository.getTasks(forceRefresh: connected);
    final todayStr = Task.nowDateString();
    final progress = await widget.taskRepository.getDailyProgress(todayStr);
    final pendingCount = await widget.taskRepository.getPendingSyncCount();

    if (mounted) {
      setState(() {
        _tasks = tasks;
        _todayProgress = progress;
        _pendingSyncCount = pendingCount;
        _isLoading = false;
      });
    }
  }

  List<Task> _getFilteredTasks(TaskTabFilter filter) {
    List<Task> filtered;

    switch (filter) {
      case TaskTabFilter.today:
        filtered = _tasks.where((t) => t.isToday() || (t.isOverdue && !t.isDone)).toList();
        break;
      case TaskTabFilter.upcoming:
        filtered = _tasks.where((t) => t.isUpcoming() && !t.isDone).toList();
        break;
      case TaskTabFilter.all:
        filtered = List.from(_tasks);
        break;
      case TaskTabFilter.completed:
        filtered = _tasks.where((t) => t.isDone).toList();
        break;
    }

    if (_searchQuery.isNotEmpty) {
      final q = _searchQuery.toLowerCase();
      filtered = filtered.where((t) =>
        t.title.toLowerCase().contains(q) ||
        t.description.toLowerCase().contains(q) ||
        t.notes.toLowerCase().contains(q)
      ).toList();
    }

    // Sort: incomplete first, high priority first, then schedule date
    filtered.sort((a, b) {
      if (a.isDone != b.isDone) return a.isDone ? 1 : -1;
      final pA = a.priority.rank;
      final pB = b.priority.rank;
      if (pA != pB) return pA.compareTo(pB);
      final sA = a.scheduledAt ?? '';
      final sB = b.scheduledAt ?? '';
      return sA.compareTo(sB);
    });

    return filtered;
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
      builder: (ctx) => const TaskEditDialog(),
    );
    if (newTask != null) {
      await widget.taskRepository.createTask(newTask);
      _loadData();
    }
  }

  Future<void> _openTodayJournalDialog() async {
    final todayStr = Task.nowDateString();
    final controller = TextEditingController(text: _todayProgress?.journalNotes ?? '');

    final saved = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text("Today's Journal ($todayStr)"),
        content: TextField(
          controller: controller,
          maxLines: 5,
          decoration: const InputDecoration(
            hintText: 'Record daily accomplishments, low-stock notes, or warehouse log...',
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
      await widget.taskRepository.saveDailyProgress(todayStr, journalNotes: saved);
      _loadData();
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    final todayTasks = _tasks.where((t) => t.isToday()).toList();
    final todayDone = todayTasks.where((t) => t.isDone).length;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Tasks'),
        actions: [
          IconButton(
            icon: const Icon(Icons.sync_rounded),
            tooltip: 'Sync Now',
            onPressed: _loadData,
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          labelColor: AppColors.primary,
          unselectedLabelColor: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
          indicatorColor: AppColors.primary,
          indicatorWeight: 3,
          isScrollable: false,
          tabs: const [
            Tab(text: 'Today'),
            Tab(text: 'Upcoming'),
            Tab(text: 'All'),
            Tab(text: 'Done'),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _addNewTask,
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add_task_rounded),
        label: const Text('New Task'),
      ),
      body: Column(
        children: [
          OfflineBanner(
            isOffline: _isOffline,
            pendingSyncCount: _pendingSyncCount,
            onSyncTap: _loadData,
          ),

          // Search Field
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Search tasks...',
                prefixIcon: const Icon(Icons.search_rounded, size: 20),
                suffixIcon: _searchQuery.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear, size: 18),
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _searchQuery = '');
                        },
                      )
                    : null,
                contentPadding: const EdgeInsets.symmetric(vertical: 0, horizontal: 16),
              ),
              onChanged: (v) => setState(() => _searchQuery = v),
            ),
          ),

          // Progress banner on Today tab
          if (_tabController.index == 0)
            DailyProgressBanner(
              totalTasks: todayTasks.length,
              completedTasks: todayDone,
              onJournalTap: _openTodayJournalDialog,
            ),

          // Tab Bar Views
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : TabBarView(
                    controller: _tabController,
                    children: [
                      _buildTaskList(TaskTabFilter.today),
                      _buildTaskList(TaskTabFilter.upcoming),
                      _buildTaskList(TaskTabFilter.all),
                      _buildTaskList(TaskTabFilter.completed),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildTaskList(TaskTabFilter filter) {
    final list = _getFilteredTasks(filter);

    if (list.isEmpty) {
      String title = 'No tasks found';
      String msg = 'Create your first task to stay organized!';
      if (filter == TaskTabFilter.today) {
        title = 'All clear for today!';
        msg = 'No tasks scheduled for today. Take a breather or plan ahead.';
      } else if (filter == TaskTabFilter.upcoming) {
        title = 'No upcoming tasks';
        msg = 'No tasks scheduled for future dates.';
      } else if (filter == TaskTabFilter.completed) {
        title = 'No completed tasks';
        msg = 'Tasks you complete will appear here.';
      }

      return RefreshIndicator(
        onRefresh: _loadData,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: Padding(
            padding: const EdgeInsets.only(top: 40),
            child: EmptyStateView(
              title: title,
              message: msg,
              icon: Icons.checklist_rounded,
              actionLabel: 'Add Task',
              onAction: _addNewTask,
            ),
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView.builder(
        padding: const EdgeInsets.only(top: 4, bottom: 80),
        itemCount: list.length,
        itemBuilder: (context, index) {
          final task = list[index];
          return TaskCard(
            task: task,
            onToggleComplete: (val) => _toggleTask(task, val),
            onTap: () => _openEdit(task),
            onEdit: () => _openEdit(task),
            onDelete: () => _deleteTask(task),
          );
        },
      ),
    );
  }
}
