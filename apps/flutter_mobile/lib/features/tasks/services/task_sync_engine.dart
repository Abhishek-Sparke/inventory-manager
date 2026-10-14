import 'dart:convert';
import 'package:stockflow_mobile/core/config/api_config.dart';
import 'package:stockflow_mobile/core/network/api_client.dart';
import 'package:stockflow_mobile/core/network/network_info.dart';
import 'package:stockflow_mobile/core/storage/local_database.dart';
import 'package:stockflow_mobile/features/tasks/models/daily_progress.dart';
import 'package:stockflow_mobile/features/tasks/models/task.dart';
import 'package:stockflow_mobile/features/inventory/models/product.dart';

class TaskSyncEngine {
  final ApiClient _apiClient;
  final LocalDatabase _localDb;
  final NetworkInfo _networkInfo;
  bool _isSyncing = false;

  TaskSyncEngine({
    ApiClient? apiClient,
    LocalDatabase? localDb,
    NetworkInfo? networkInfo,
  })  : _apiClient = apiClient ?? ApiClient(),
        _localDb = localDb ?? LocalDatabase.instance,
        _networkInfo = networkInfo ?? NetworkInfo() {
    _networkInfo.onConnectivityChanged.listen((isConnected) {
      if (isConnected) {
        processPendingSyncQueue();
      }
    });
  }

  Future<int> processPendingSyncQueue() async {
    if (_isSyncing) return 0;
    final isOnline = await _networkInfo.isConnected;
    if (!isOnline) return 0;

    _isSyncing = true;
    int syncedCount = 0;
    try {
      final items = await _localDb.getPendingSyncItems();
      for (final item in items) {
        final id = item['id'] as int;
        final action = item['action'] as String;
        final entityType = item['entity_type'] as String;
        final entityId = item['entity_id'] as int?;
        final dateKey = item['date_key'] as String?;
        final payloadJson = item['payload_json'] as String;

        try {
          final payload = jsonDecode(payloadJson) as Map<String, dynamic>;

          if (entityType == 'task') {
            await _syncTaskItem(action, entityId, payload);
          } else if (entityType == 'product') {
            await _syncProductItem(action, entityId, payload);
          } else if (entityType == 'daily_progress') {
            await _syncDailyProgressItem(action, dateKey, payload);
          }

          // Successfully processed: remove from queue
          await _localDb.removeSyncItem(id);
          syncedCount++;
        } catch (e) {
          // Increment retry count; preserve in queue for next cycle
          await _localDb.incrementSyncRetry(id);
        }
      }
      return syncedCount;
    } finally {
      _isSyncing = false;
    }
  }

  Future<void> _syncTaskItem(
    String action,
    int? entityId,
    Map<String, dynamic> payload,
  ) async {
    if (action == 'create') {
      final res = await _apiClient.post(ApiConfig.tasksUrl, body: payload);
      final created = Task.fromJson(res as Map<String, dynamic>);
      if (entityId != null && entityId < 0) {
        await _localDb.deleteTask(entityId);
      }
      await _localDb.insertTask(created.copyWith(isSynced: true));
    } else if (action == 'update' && entityId != null && entityId > 0) {
      final res = await _apiClient.put(
        ApiConfig.taskDetailUrl(entityId),
        body: payload,
      );
      final updated = Task.fromJson(res as Map<String, dynamic>);
      await _localDb.updateTask(updated.copyWith(isSynced: true));
    } else if (action == 'delete' && entityId != null && entityId > 0) {
      await _apiClient.delete(ApiConfig.taskDetailUrl(entityId));
    }
  }

  Future<void> _syncProductItem(
    String action,
    int? entityId,
    Map<String, dynamic> payload,
  ) async {
    if (action == 'create') {
      final res = await _apiClient.post(ApiConfig.productsUrl, body: payload);
      final created = Product.fromJson(res as Map<String, dynamic>);
      if (entityId != null && entityId < 0) {
        await _localDb.deleteProduct(entityId);
      }
      await _localDb.insertProduct(created.copyWith(isSynced: true));
    } else if (action == 'update' && entityId != null && entityId > 0) {
      final res = await _apiClient.put(
        ApiConfig.productDetailUrl(entityId),
        body: payload,
      );
      final updated = Product.fromJson(res as Map<String, dynamic>);
      await _localDb.updateProduct(updated.copyWith(isSynced: true));
    } else if (action == 'delete' && entityId != null && entityId > 0) {
      await _apiClient.delete(ApiConfig.productDetailUrl(entityId));
    }
  }

  Future<void> _syncDailyProgressItem(
    String action,
    String? dateKey,
    Map<String, dynamic> payload,
  ) async {
    final res = await _apiClient.post(ApiConfig.dailyProgressUrl, body: payload);
    final dp = DailyProgress.fromJson(res as Map<String, dynamic>);
    await _localDb.saveDailyProgress(dp.copyWith(isSynced: true));
  }
}
