import 'dart:async';
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';
import '../../features/inventory/models/product.dart';
import '../../features/tasks/models/daily_progress.dart';
import '../../features/tasks/models/task.dart';

class LocalDatabase {
  static const String databaseName = 'stockflow.db';
  static const int databaseVersion = 1;

  static LocalDatabase? _instance;
  static Database? _database;

  LocalDatabase._();

  static LocalDatabase get instance {
    _instance ??= LocalDatabase._();
    return _instance!;
  }

  Future<Database> get database async {
    if (_database != null && _database!.isOpen) {
      return _database!;
    }
    _database = await _initDatabase();
    return _database!;
  }

  Future<Database> _initDatabase() async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, databaseName);

    return await openDatabase(
      path,
      version: databaseVersion,
      onCreate: _onCreate,
      onConfigure: _onConfigure,
    );
  }

  Future<void> _onConfigure(Database db) async {
    await db.execute('PRAGMA foreign_keys = ON;');
  }

  Future<void> _onCreate(Database db, int version) async {
    await db.transaction((txn) async {
      // 1. Tasks Table
      await txn.execute('''
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          scheduled_at TEXT,
          end_at TEXT,
          priority TEXT NOT NULL DEFAULT 'medium',
          status TEXT NOT NULL DEFAULT 'pending',
          is_completed INTEGER NOT NULL DEFAULT 0,
          notes TEXT NOT NULL DEFAULT '',
          journal_entry TEXT NOT NULL DEFAULT '',
          reminder_minutes INTEGER DEFAULT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          is_synced INTEGER NOT NULL DEFAULT 1
        );
      ''');

      await txn.execute('CREATE INDEX idx_tasks_scheduled ON tasks(scheduled_at);');
      await txn.execute('CREATE INDEX idx_tasks_completed ON tasks(is_completed);');
      await txn.execute('CREATE INDEX idx_tasks_priority ON tasks(priority);');

      // 2. Products Table
      await txn.execute('''
        CREATE TABLE products (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          sku TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          price REAL NOT NULL,
          quantity INTEGER NOT NULL DEFAULT 0,
          reorder_level INTEGER NOT NULL DEFAULT 10,
          expiry_date TEXT,
          created_at TEXT,
          updated_at TEXT,
          is_synced INTEGER NOT NULL DEFAULT 1
        );
      ''');

      await txn.execute('CREATE INDEX idx_products_sku ON products(sku);');
      await txn.execute('CREATE INDEX idx_products_category ON products(category);');

      // 3. Daily Progress Table
      await txn.execute('''
        CREATE TABLE daily_progress (
          date TEXT PRIMARY KEY,
          description TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          achievements TEXT NOT NULL DEFAULT '',
          next_steps TEXT NOT NULL DEFAULT '',
          linked_task INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          is_synced INTEGER NOT NULL DEFAULT 1
        );
      ''');

      // 4. Task Reminders Table
      await txn.execute('''
        CREATE TABLE task_reminders (
          task_id INTEGER PRIMARY KEY,
          notification_id TEXT NOT NULL,
          trigger_time TEXT NOT NULL,
          offset_minutes INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );
      ''');

      // 5. Offline Sync Queue Table
      await txn.execute('''
        CREATE TABLE sync_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id INTEGER,
          date_key TEXT,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          retry_count INTEGER NOT NULL DEFAULT 0
        );
      ''');
    });
  }

  // ==========================================
  // TASK OPERATIONS
  // ==========================================

  Future<List<Task>> getAllTasks() async {
    final db = await database;
    final List<Map<String, dynamic>> maps = await db.rawQuery('''
      SELECT * FROM tasks
      ORDER BY
        CASE priority
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
          ELSE 2
        END ASC,
        CASE WHEN scheduled_at IS NULL THEN 1 ELSE 0 END ASC,
        scheduled_at ASC;
    ''');
    return maps.map(Task.fromSqliteMap).toList();
  }

  Future<Task?> getTaskById(int id) async {
    final db = await database;
    final List<Map<String, dynamic>> maps = await db.query(
      'tasks',
      where: 'id = ?',
      whereArgs: [id],
    );
    if (maps.isEmpty) return null;
    return Task.fromSqliteMap(maps.first);
  }

  Future<int> insertTask(Task task) async {
    final db = await database;
    final map = task.toSqliteMap();
    if (task.id <= 0) {
      map.remove('id');
    }
    return await db.insert(
      'tasks',
      map,
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<int> updateTask(Task task) async {
    final db = await database;
    return await db.update(
      'tasks',
      task.toSqliteMap(),
      where: 'id = ?',
      whereArgs: [task.id],
    );
  }

  Future<int> deleteTask(int id) async {
    final db = await database;
    await db.delete('task_reminders', where: 'task_id = ?', whereArgs: [id]);
    return await db.delete('tasks', where: 'id = ?', whereArgs: [id]);
  }

  Future<void> replaceAllTasks(List<Task> remoteTasks) async {
    final db = await database;
    await db.transaction((txn) async {
      for (final t in remoteTasks) {
        await txn.insert(
          'tasks',
          t.toSqliteMap(),
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
    });
  }

  // ==========================================
  // PRODUCT OPERATIONS
  // ==========================================

  Future<List<Product>> getAllProducts() async {
    final db = await database;
    final List<Map<String, dynamic>> maps = await db.query(
      'products',
      orderBy: 'name ASC',
    );
    return maps.map(Product.fromSqliteMap).toList();
  }

  Future<Product?> getProductById(int id) async {
    final db = await database;
    final List<Map<String, dynamic>> maps = await db.query(
      'products',
      where: 'id = ?',
      whereArgs: [id],
    );
    if (maps.isEmpty) return null;
    return Product.fromSqliteMap(maps.first);
  }

  Future<int> insertProduct(Product product) async {
    final db = await database;
    return await db.insert(
      'products',
      product.toSqliteMap(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<int> updateProduct(Product product) async {
    final db = await database;
    return await db.update(
      'products',
      product.toSqliteMap(),
      where: 'id = ?',
      whereArgs: [product.id],
    );
  }

  Future<int> deleteProduct(int id) async {
    final db = await database;
    return await db.delete('products', where: 'id = ?', whereArgs: [id]);
  }

  Future<void> replaceAllProducts(List<Product> remoteProducts) async {
    final db = await database;
    await db.transaction((txn) async {
      await txn.delete('products', where: 'is_synced = 1');
      for (final p in remoteProducts) {
        await txn.insert(
          'products',
          p.toSqliteMap(),
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
    });
  }

  // ==========================================
  // DAILY PROGRESS OPERATIONS
  // ==========================================

  Future<DailyProgress?> getDailyProgress(String date) async {
    final db = await database;
    final maps = await db.query(
      'daily_progress',
      where: 'date = ?',
      whereArgs: [date],
    );
    if (maps.isEmpty) return null;
    return DailyProgress.fromSqliteMap(maps.first);
  }

  Future<List<DailyProgress>> getAllDailyProgress() async {
    final db = await database;
    final maps = await db.query('daily_progress', orderBy: 'date DESC');
    return maps.map(DailyProgress.fromSqliteMap).toList();
  }

  Future<void> saveDailyProgress(DailyProgress progress) async {
    final db = await database;
    await db.insert(
      'daily_progress',
      progress.toSqliteMap(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  // ==========================================
  // NOTIFICATION REMINDERS
  // ==========================================

  Future<void> saveTaskReminder({
    required int taskId,
    required String notificationId,
    required String triggerTime,
    required int offsetMinutes,
  }) async {
    final db = await database;
    final now = DateTime.now().toIso8601String();
    await db.insert(
      'task_reminders',
      {
        'task_id': taskId,
        'notification_id': notificationId,
        'trigger_time': triggerTime,
        'offset_minutes': offsetMinutes,
        'created_at': now,
        'updated_at': now,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<Map<String, dynamic>?> getTaskReminder(int taskId) async {
    final db = await database;
    final rows = await db.query(
      'task_reminders',
      where: 'task_id = ?',
      whereArgs: [taskId],
    );
    if (rows.isEmpty) return null;
    return rows.first;
  }

  Future<void> deleteTaskReminder(int taskId) async {
    final db = await database;
    await db.delete('task_reminders', where: 'task_id = ?', whereArgs: [taskId]);
  }

  Future<List<Map<String, dynamic>>> getAllTaskReminders() async {
    final db = await database;
    return await db.query('task_reminders');
  }

  // ==========================================
  // SYNC QUEUE OPERATIONS
  // ==========================================

  Future<int> enqueueSync({
    required String action,
    required String entityType,
    int? entityId,
    String? dateKey,
    required String payloadJson,
  }) async {
    final db = await database;
    return await db.insert('sync_queue', {
      'action': action,
      'entity_type': entityType,
      'entity_id': entityId,
      'date_key': dateKey,
      'payload_json': payloadJson,
      'created_at': DateTime.now().toIso8601String(),
      'retry_count': 0,
    });
  }

  Future<int> getPendingSyncCount([String? entityType]) async {
    final db = await database;
    if (entityType != null) {
      final res = await db.rawQuery(
        'SELECT COUNT(*) as cnt FROM sync_queue WHERE entity_type = ?',
        [entityType],
      );
      return (res.first['cnt'] as int?) ?? 0;
    } else {
      final res = await db.rawQuery('SELECT COUNT(*) as cnt FROM sync_queue');
      return (res.first['cnt'] as int?) ?? 0;
    }
  }

  Future<List<Map<String, dynamic>>> getPendingSyncItems() async {
    final db = await database;
    return await db.query('sync_queue', orderBy: 'id ASC');
  }

  Future<void> removeSyncItem(int id) async {
    final db = await database;
    await db.delete('sync_queue', where: 'id = ?', whereArgs: [id]);
  }

  Future<void> incrementSyncRetry(int id) async {
    final db = await database;
    await db.rawUpdate(
      'UPDATE sync_queue SET retry_count = retry_count + 1 WHERE id = ?',
      [id],
    );
  }

  Future<void> close() async {
    if (_database != null && _database!.isOpen) {
      await _database!.close();
      _database = null;
    }
  }
}
