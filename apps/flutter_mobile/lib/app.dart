import 'package:flutter/material.dart';
import 'core/config/app_theme.dart';
import 'core/network/network_info.dart';
import 'features/inventory/services/inventory_repository.dart';
import 'features/shell/presentation/main_navigation_shell.dart';
import 'features/tasks/services/task_repository.dart';

class StockFlowApp extends StatelessWidget {
  final TaskRepository taskRepository;
  final InventoryRepository inventoryRepository;
  final NetworkInfo networkInfo;

  const StockFlowApp({
    super.key,
    required this.taskRepository,
    required this.inventoryRepository,
    required this.networkInfo,
  });

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'StockFlow',
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: ThemeMode.system,
      debugShowCheckedModeBanner: false,
      home: MainNavigationShell(
        taskRepository: taskRepository,
        inventoryRepository: inventoryRepository,
        networkInfo: networkInfo,
      ),
    );
  }
}
