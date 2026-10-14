import 'package:flutter/material.dart';
import 'app.dart';
import 'core/network/api_client.dart';
import 'core/network/network_info.dart';
import 'core/notifications/notification_service.dart';
import 'core/storage/local_database.dart';
import 'features/auth/services/installation_service.dart';
import 'features/inventory/services/inventory_repository.dart';
import 'features/tasks/services/task_repository.dart';
import 'features/tasks/services/task_sync_engine.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 1. Initialize SQLite Database
  try {
    await LocalDatabase.instance.database;
  } catch (e) {
    debugPrint('LocalDatabase initialization note: $e');
  }

  // 2. Initialize Local Notifications
  try {
    final notifs = NotificationService.instance;
    await notifs.initialize();
    await notifs.requestPermissions();
  } catch (e) {
    debugPrint('Notification service initialization note: $e');
  }

  // 3. Network and API Core
  final networkInfo = NetworkInfo();
  final apiClient = ApiClient();

  // 4. Installation Bootstrap Handshake
  try {
    final installationService = InstallationService(apiClient: apiClient);
    await installationService.getCredentials();
  } catch (e) {
    debugPrint('Installation bootstrap note: $e');
  }

  // 5. Repositories and Sync Engines
  final syncEngine = TaskSyncEngine(apiClient: apiClient, networkInfo: networkInfo);
  final taskRepository = TaskRepository(
    apiClient: apiClient,
    syncEngine: syncEngine,
    networkInfo: networkInfo,
  );
  final inventoryRepository = InventoryRepository(
    apiClient: apiClient,
    networkInfo: networkInfo,
  );

  // 6. Launch App
  runApp(
    StockFlowApp(
      taskRepository: taskRepository,
      inventoryRepository: inventoryRepository,
      networkInfo: networkInfo,
    ),
  );
}
