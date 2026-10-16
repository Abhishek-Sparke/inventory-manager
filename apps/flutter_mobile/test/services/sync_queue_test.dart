import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:stockflow_mobile/features/tasks/models/task.dart';
import 'package:stockflow_mobile/features/inventory/models/product.dart';

void main() {
  group('Sync Queue Serialization & Reconciliation Tests', () {
    test('Task mutation payload formats correctly for offline create queue', () {
      const task = Task(
        id: -1, // Negative ID indicating locally created offline entity
        title: 'Perform warehouse inventory check',
        description: 'Verify shelf B4',
        priority: TaskPriority.high,
        isCompleted: false,
        isSynced: false,
      );

      final queuePayload = {
        'entity_type': 'task',
        'action': 'create',
        'entity_id': task.id,
        'payload': jsonEncode(task.toJson()),
        'created_at': DateTime.now().toIso8601String(),
        'attempts': 0,
      };

      expect(queuePayload['entity_type'], 'task');
      expect(queuePayload['action'], 'create');
      expect(queuePayload['entity_id'], -1);

      final decoded = jsonDecode(queuePayload['payload'] as String) as Map<String, dynamic>;
      expect(decoded['title'], 'Perform warehouse inventory check');
      expect(decoded['priority'], 'high');
      expect(decoded['is_completed'], false);
    });

    test('Product mutation payload formats correctly for offline update queue', () {
      const product = Product(
        id: 50,
        name: 'Updated Barcode Reader',
        sku: 'RDR-0050',
        price: 99.50,
        quantity: 12,
        reorderLevel: 5,
        isSynced: false,
      );

      final queuePayload = {
        'entity_type': 'product',
        'action': 'update',
        'entity_id': product.id,
        'payload': jsonEncode(product.toJson()),
        'created_at': DateTime.now().toIso8601String(),
        'attempts': 0,
      };

      expect(queuePayload['entity_type'], 'product');
      expect(queuePayload['action'], 'update');
      expect(queuePayload['entity_id'], 50);

      final decoded = jsonDecode(queuePayload['payload'] as String) as Map<String, dynamic>;
      expect(decoded['name'], 'Updated Barcode Reader');
      expect(decoded['quantity'], 12);
      expect(decoded['price'], '99.50');
    });

    test('Sync queue handles exponential backoff calculation safely', () {
      int calculateBackoffSeconds(int attempts) {
        if (attempts <= 0) return 1;
        if (attempts >= 6) return 60; // Max cap 60 seconds
        return 1 << attempts; // 2, 4, 8, 16, 32, 64...
      }

      expect(calculateBackoffSeconds(0), 1);
      expect(calculateBackoffSeconds(1), 2);
      expect(calculateBackoffSeconds(2), 4);
      expect(calculateBackoffSeconds(3), 8);
      expect(calculateBackoffSeconds(4), 16);
      expect(calculateBackoffSeconds(5), 32);
      expect(calculateBackoffSeconds(6), 60);
      expect(calculateBackoffSeconds(10), 60);
    });
  });
}
