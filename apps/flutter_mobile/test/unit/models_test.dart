import 'package:flutter_test/flutter_test.dart';
import 'package:stockflow_mobile/features/inventory/models/product.dart';
import 'package:stockflow_mobile/features/tasks/models/task.dart';
import 'package:stockflow_mobile/features/tasks/models/daily_progress.dart';
import 'package:stockflow_mobile/features/auth/models/installation.dart';

void main() {
  group('Product Model Tests', () {
    test('Product.fromJson parses valid API response correctly', () {
      final json = {
        'id': 101,
        'name': 'Wireless Barcode Scanner',
        'sku': 'SCAN-001',
        'category': 'Electronics',
        'description': 'Handheld laser scanner',
        'price': '89.99',
        'quantity': 25,
        'reorder_level': 10,
        'expiry_date': '2027-12-31',
        'created_at': '2026-01-01T00:00:00Z',
        'updated_at': '2026-01-02T00:00:00Z',
      };

      final p = Product.fromJson(json);

      expect(p.id, 101);
      expect(p.name, 'Wireless Barcode Scanner');
      expect(p.sku, 'SCAN-001');
      expect(p.category, 'Electronics');
      expect(p.quantity, 25);
      expect(p.price, 89.99);
      expect(p.reorderLevel, 10);
      expect(p.isOutOfStock, false);
      expect(p.isLowStock, false);
      expect(p.isExpired, false);
      expect(p.isSynced, true);
    });

    test('Product stock status calculations work accurately', () {
      const outOfStockProduct = Product(
        id: 1,
        name: 'Item A',
        sku: 'ITEM-A',
        price: 10.0,
        quantity: 0,
        reorderLevel: 5,
      );
      expect(outOfStockProduct.isOutOfStock, true);
      expect(outOfStockProduct.isLowStock, false);

      const lowStockProduct = Product(
        id: 2,
        name: 'Item B',
        sku: 'ITEM-B',
        price: 15.0,
        quantity: 4,
        reorderLevel: 5,
      );
      expect(lowStockProduct.isOutOfStock, false);
      expect(lowStockProduct.isLowStock, true);

      const normalProduct = Product(
        id: 3,
        name: 'Item C',
        sku: 'ITEM-C',
        price: 20.0,
        quantity: 20,
        reorderLevel: 5,
      );
      expect(normalProduct.isOutOfStock, false);
      expect(normalProduct.isLowStock, false);
    });

    test('Product expiry calculation identifies expired and upcoming products', () {
      const expired = Product(
        id: 4,
        name: 'Milk',
        sku: 'MILK-01',
        price: 3.50,
        quantity: 5,
        expiryDate: '2020-01-01',
      );
      expect(expired.isExpired, true);
      expect(expired.daysUntilExpiry! < 0, true);

      const future = Product(
        id: 5,
        name: 'Honey',
        sku: 'HONEY-01',
        price: 7.00,
        quantity: 10,
        expiryDate: '2030-01-01',
      );
      expect(future.isExpired, false);
      expect(future.daysUntilExpiry! > 30, true);
    });

    test('Product SQLite serialization roundtrip preserves values', () {
      const p1 = Product(
        id: 99,
        name: 'Thermal Receipt Rolls',
        sku: 'ROLL-50',
        category: 'Supplies',
        price: 1.25,
        quantity: 150,
        reorderLevel: 30,
        expiryDate: '2028-06-15',
        isSynced: false,
      );

      final map = p1.toSqliteMap();
      final p2 = Product.fromSqliteMap(map);

      expect(p2.id, p1.id);
      expect(p2.name, p1.name);
      expect(p2.sku, p1.sku);
      expect(p2.category, p1.category);
      expect(p2.quantity, p1.quantity);
      expect(p2.price, p1.price);
      expect(p2.reorderLevel, p1.reorderLevel);
      expect(p2.expiryDate, p1.expiryDate);
      expect(p2.isSynced, p1.isSynced);
    });
  });

  group('Task Model Tests', () {
    test('Task.fromJson parses priorities and completion status', () {
      final json = {
        'id': 42,
        'title': 'Audit cold storage inventory',
        'description': 'Check vaccine temperatures and log levels',
        'scheduled_at': '2026-10-15T09:00:00Z',
        'priority': 'high',
        'status': 'in_progress',
        'is_completed': false,
        'reminder_minutes': 30,
      };

      final t = Task.fromJson(json);

      expect(t.id, 42);
      expect(t.title, 'Audit cold storage inventory');
      expect(t.priority, TaskPriority.high);
      expect(t.priority.rank, 1);
      expect(t.status, TaskStatus.inProgress);
      expect(t.isDone, false);
      expect(t.reminderMinutes, 30);
    });

    test('Task date helpers correctly identify today, upcoming, and overdue', () {
      final now = DateTime.now();
      final todayTask = Task(
        id: 1,
        title: 'Today Task',
        scheduledAt: now.toIso8601String(),
      );
      expect(todayTask.isToday(now), true);
      expect(todayTask.isUpcoming(now), false);

      final upcomingTask = Task(
        id: 2,
        title: 'Next Week Task',
        scheduledAt: now.add(const Duration(days: 4)).toIso8601String(),
      );
      expect(upcomingTask.isToday(now), false);
      expect(upcomingTask.isUpcoming(now), true);

      final overdueTask = Task(
        id: 3,
        title: 'Past Task',
        scheduledAt: now.subtract(const Duration(days: 2)).toIso8601String(),
        isCompleted: false,
      );
      expect(overdueTask.isOverdue, true);

      // Completed tasks are never overdue
      final completedPastTask = overdueTask.copyWith(isCompleted: true);
      expect(completedPastTask.isOverdue, false);
    });

    test('Task SQLite serialization roundtrip preserves all fields', () {
      const t1 = Task(
        id: 77,
        title: 'Order replacement barcodes',
        description: 'Supplier ABC catalog page 4',
        scheduledAt: '2026-11-01T14:00:00Z',
        priority: TaskPriority.low,
        status: TaskStatus.completed,
        isCompleted: true,
        notes: 'Vendor contacted via email',
        journalEntry: 'Vendor contacted via email',
        reminderMinutes: 15,
        isSynced: false,
      );

      final map = t1.toSqliteMap();
      final t2 = Task.fromSqliteMap(map);

      expect(t2.id, t1.id);
      expect(t2.title, t1.title);
      expect(t2.description, t1.description);
      expect(t2.scheduledAt, t1.scheduledAt);
      expect(t2.priority, t1.priority);
      expect(t2.status, t1.status);
      expect(t2.isCompleted, t1.isCompleted);
      expect(t2.isDone, true);
      expect(t2.notes, t1.notes);
      expect(t2.reminderMinutes, t1.reminderMinutes);
      expect(t2.isSynced, false);
    });
  });

  group('DailyProgress Model Tests', () {
    test('DailyProgress SQLite mapping and properties', () {
      const p1 = DailyProgress(
        date: '2026-10-14',
        description: 'Completed morning inventory audit',
        notes: 'Good progress across all warehouse sections.',
        achievements: 'Counted 120 SKUs',
        nextSteps: 'Order low stock items',
        updatedAt: '2026-10-14T18:00:00Z',
      );

      final map = p1.toSqliteMap();
      final p2 = DailyProgress.fromSqliteMap(map);

      expect(p2.date, '2026-10-14');
      expect(p2.description, p1.description);
      expect(p2.notes, p1.notes);
      expect(p2.achievements, p1.achievements);
      expect(p2.nextSteps, p1.nextSteps);
    });
  });

  group('InstallationCredentials Model Tests', () {
    test('InstallationCredentials serialization preserves token and device identifier', () {
      const inst = InstallationCredentials(
        installationId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
        installationToken: 'sec_tok_9918273645',
        deviceName: 'Mobile Flutter Client',
        createdAt: '2026-10-14T10:00:00Z',
      );

      final json = inst.toJson();
      final inst2 = InstallationCredentials.fromJson(json);

      expect(inst2.installationId, inst.installationId);
      expect(inst2.installationToken, inst.installationToken);
      expect(inst2.deviceName, inst.deviceName);
      expect(inst2.isValid, true);
    });
  });
}
