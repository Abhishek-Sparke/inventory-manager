import 'package:flutter/material.dart';
import '../../../../core/network/network_info.dart';
import '../../inventory/presentation/screens/inventory_screen.dart';
import '../../inventory/services/inventory_repository.dart';
import '../../settings/presentation/settings_screen.dart';
import '../../tasks/presentation/screens/calendar_view.dart';
import '../../tasks/presentation/screens/tasks_screen.dart';
import '../../tasks/services/task_repository.dart';

class MainNavigationShell extends StatefulWidget {
  final TaskRepository taskRepository;
  final InventoryRepository inventoryRepository;
  final NetworkInfo networkInfo;

  const MainNavigationShell({
    super.key,
    required this.taskRepository,
    required this.inventoryRepository,
    required this.networkInfo,
  });

  @override
  State<MainNavigationShell> createState() => _MainNavigationShellState();
}

class _MainNavigationShellState extends State<MainNavigationShell> {
  int _currentIndex = 0;

  late final List<Widget> _screens;

  @override
  void initState() {
    super.initState();
    _screens = [
      InventoryScreen(
        repository: widget.inventoryRepository,
        networkInfo: widget.networkInfo,
      ),
      TasksScreen(
        taskRepository: widget.taskRepository,
        networkInfo: widget.networkInfo,
      ),
      CalendarViewScreen(
        taskRepository: widget.taskRepository,
      ),
      SettingsScreen(
        taskRepository: widget.taskRepository,
        inventoryRepository: widget.inventoryRepository,
        networkInfo: widget.networkInfo,
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: _screens,
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (index) => setState(() => _currentIndex = index),
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.inventory_2_outlined),
            activeIcon: Icon(Icons.inventory_2_rounded),
            label: 'Inventory',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.checklist_rtl_outlined),
            activeIcon: Icon(Icons.checklist_rtl_rounded),
            label: 'Tasks',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.calendar_month_outlined),
            activeIcon: Icon(Icons.calendar_month_rounded),
            label: 'Calendar',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.tune_outlined),
            activeIcon: Icon(Icons.tune_rounded),
            label: 'Settings',
          ),
        ],
      ),
    );
  }
}
