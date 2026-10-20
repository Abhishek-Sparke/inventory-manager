import 'dart:convert';
import 'package:stockflow_mobile/core/config/api_config.dart';
import 'package:stockflow_mobile/core/network/api_client.dart';
import 'package:stockflow_mobile/core/network/network_info.dart';
import 'package:stockflow_mobile/core/notifications/notification_service.dart';
import 'package:stockflow_mobile/core/storage/local_database.dart';
import 'package:stockflow_mobile/features/inventory/models/product.dart';

import 'package:stockflow_mobile/features/tasks/services/task_sync_engine.dart';

class InventoryRepository {
  final ApiClient _apiClient;
  final LocalDatabase _localDb;
  final NetworkInfo _networkInfo;
  final NotificationService _notifications;

  InventoryRepository({
    ApiClient? apiClient,
    LocalDatabase? localDb,
    NetworkInfo? networkInfo,
    NotificationService? notifications,
  })  : _apiClient = apiClient ?? ApiClient(),
        _localDb = localDb ?? LocalDatabase.instance,
        _networkInfo = networkInfo ?? NetworkInfo(),
        _notifications = notifications ?? NotificationService();

  Future<int> getPendingSyncCount() => _localDb.getPendingSyncCount('product');

  Future<int> syncPendingQueue() async {
    final syncEngine = TaskSyncEngine(
      apiClient: _apiClient,
      localDb: _localDb,
      networkInfo: _networkInfo,
    );
    return await syncEngine.processPendingSyncQueue();
  }

  Future<List<Product>> getProducts({bool forceRefresh = false}) async {
    // 1. Always load local cache first for instant UI response
    final localProducts = await _localDb.getAllProducts();

    final isOnline = await _networkInfo.isConnected;
    if (!isOnline && localProducts.isNotEmpty) {
      return localProducts;
    }

    // 2. Fetch fresh data from remote API if online
    if (isOnline) {
      try {
        final response = await _apiClient.get(ApiConfig.productsUrl);
        if (response is List) {
          final remoteProducts = response
              .map((item) => Product.fromJson(item as Map<String, dynamic>))
              .toList();

          // Update local SQLite cache
          await _localDb.replaceAllProducts(remoteProducts);

          // Evaluate inventory alerts
          _evaluateAndTriggerAlerts(remoteProducts);

          return await _localDb.getAllProducts();
        }
      } catch (e) {
        // Fall back to local SQLite on network failure
        if (localProducts.isNotEmpty) {
          return localProducts;
        }
        rethrow;
      }
    }

    return localProducts;
  }

  Future<Product> addProduct(Product product) async {
    final isOnline = await _networkInfo.isConnected;

    if (isOnline) {
      try {
        final response = await _apiClient.post(
          ApiConfig.productsUrl,
          body: product.toJson(),
        );
        final created = Product.fromJson(response as Map<String, dynamic>);
        await _localDb.insertProduct(created);
        return created;
      } catch (_) {
        // Network error during send; fallback to offline queue
      }
    }

    // Offline mode: generate temporary negative local ID
    final tempId = -DateTime.now().millisecondsSinceEpoch;
    final offlineProduct = product.copyWith(id: tempId, isSynced: false);
    await _localDb.insertProduct(offlineProduct);

    await _localDb.enqueueSync(
      action: 'create',
      entityType: 'product',
      entityId: tempId,
      payloadJson: jsonEncode(product.toJson()),
    );

    return offlineProduct;
  }

  Future<Product> updateProduct(Product product) async {
    final isOnline = await _networkInfo.isConnected;

    if (isOnline && product.id > 0) {
      try {
        final response = await _apiClient.put(
          ApiConfig.productDetailUrl(product.id),
          body: product.toJson(),
        );
        final updated = Product.fromJson(response as Map<String, dynamic>);
        await _localDb.updateProduct(updated);
        return updated;
      } catch (_) {
        // Fallback to offline queue
      }
    }

    // Offline mode
    final offlineProduct = product.copyWith(isSynced: false);
    await _localDb.updateProduct(offlineProduct);

    await _localDb.enqueueSync(
      action: 'update',
      entityType: 'product',
      entityId: product.id,
      payloadJson: jsonEncode(product.toJson()),
    );

    return offlineProduct;
  }

  Future<void> deleteProduct(int id) async {
    final isOnline = await _networkInfo.isConnected;

    await _localDb.deleteProduct(id);

    if (isOnline && id > 0) {
      try {
        await _apiClient.delete(ApiConfig.productDetailUrl(id));
        return;
      } catch (_) {}
    }

    if (id > 0) {
      await _localDb.enqueueSync(
        action: 'delete',
        entityType: 'product',
        entityId: id,
        payloadJson: jsonEncode({'id': id}),
      );
    }
  }

  void _evaluateAndTriggerAlerts(List<Product> products) {
    for (final p in products) {
      if (p.isOutOfStock) {
        _notifications.showInventoryAlert(
          id: p.id * 10 + 1,
          title: 'Out of Stock: ${p.name}',
          body: '${p.name} (SKU: ${p.sku}) is completely out of stock!',
        );
      } else if (p.isLowStock) {
        _notifications.showInventoryAlert(
          id: p.id * 10 + 2,
          title: 'Low Stock Alert: ${p.name}',
          body: 'Only ${p.quantity} units remaining (reorder level: ${p.reorderLevel}).',
        );
      }

      if (p.isExpired) {
        _notifications.showInventoryAlert(
          id: p.id * 10 + 3,
          title: 'Product Expired: ${p.name}',
          body: '${p.name} expired on ${p.expiryDate}. Please remove from inventory.',
        );
      } else if (p.isExpiringSoon) {
        _notifications.showInventoryAlert(
          id: p.id * 10 + 4,
          title: 'Expiring Soon: ${p.name}',
          body: '${p.name} expires in ${p.daysUntilExpiry} days (${p.expiryDate}).',
        );
      }
    }
  }
}
