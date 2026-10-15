/**
 * StockFlow SQLite Local Database Service
 *
 * Provides offline-first, versioned, transaction-safe SQLite storage
 * for tasks, daily progress journals, and notification reminders.
 *
 * Operates universally in Expo React Native (via expo-sqlite) and in
 * automated Node.js test environments (via node:sqlite).
 */

import { Task, TaskPriority, TaskStatus } from '@/components/tasks/types';
import { DailyProgress } from '@/services/daily-progress';
import { getLocalDateString } from '@/utils/timezone';

export const CURRENT_SCHEMA_VERSION = 1;
export const DATABASE_NAME = 'stockflow.db';

export interface SQLiteDriver {
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): { lastInsertRowId: number; changes: number };
  getAll<T = unknown>(sql: string, params?: unknown[]): T[];
  getFirst<T = unknown>(sql: string, params?: unknown[]): T | null;
  transaction<T>(fn: () => T): T;
  close(): void;
}

export interface TaskReminderRecord {
  task_id: number;
  notification_id: string;
  trigger_time: string;
  offset_minutes: number;
  created_at: string;
  updated_at: string;
}

let activeDriver: SQLiteDriver | null = null;
let isInitialized = false;

/**
 * Creates driver wrapper for Node.js test environment using built-in node:sqlite.
 */
function createNodeDriver(dbPath: string): SQLiteDriver {
  // Use dynamic evaluation so React Native Metro bundler doesn't attempt to bundle node:sqlite
  const dynamicRequire = typeof __webpack_require__ === 'function' ? null : eval('require');
  const { DatabaseSync } = dynamicRequire('node:sqlite');
  const db = new DatabaseSync(dbPath);

  // Enable WAL mode and foreign keys for performance and referential integrity
  try {
    db.exec('PRAGMA foreign_keys = ON;');
  } catch {}

  return {
    exec(sql: string) {
      db.exec(sql);
    },
    run(sql: string, params: unknown[] = []) {
      const stmt = db.prepare(sql);
      const result = stmt.run(...params);
      return {
        lastInsertRowId: Number(result.lastInsertRowid ?? 0),
        changes: Number(result.changes ?? 0),
      };
    },
    getAll<T = unknown>(sql: string, params: unknown[] = []): T[] {
      const stmt = db.prepare(sql);
      return stmt.all(...params) as T[];
    },
    getFirst<T = unknown>(sql: string, params: unknown[] = []): T | null {
      const stmt = db.prepare(sql);
      const row = stmt.get(...params);
      return (row as T) ?? null;
    },
    transaction<T>(fn: () => T): T {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {}
        throw err;
      }
    },
    close() {
      try {
        db.close();
      } catch {}
    },
  };
}

/**
 * Creates driver wrapper for Expo React Native environment using expo-sqlite.
 */
function createExpoDriver(dbName: string): SQLiteDriver {
  const SQLite = require('expo-sqlite');
  const db = SQLite.openDatabaseSync(dbName);

  try {
    db.execSync('PRAGMA foreign_keys = ON;');
    db.execSync('PRAGMA journal_mode = WAL;');
  } catch (err) {
    console.warn('[Database] PRAGMA config notice:', err);
  }

  return {
    exec(sql: string) {
      db.execSync(sql);
    },
    run(sql: string, params: unknown[] = []) {
      const result = db.runSync(sql, params);
      return {
        lastInsertRowId: Number(result.lastInsertRowId ?? 0),
        changes: Number(result.changes ?? 0),
      };
    },
    getAll<T = unknown>(sql: string, params: unknown[] = []): T[] {
      return db.getAllSync(sql, params) as T[];
    },
    getFirst<T = unknown>(sql: string, params: unknown[] = []): T | null {
      const row = db.getFirstSync(sql, params);
      return (row as T) ?? null;
    },
    transaction<T>(fn: () => T): T {
      db.execSync('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.execSync('COMMIT');
        return result;
      } catch (err) {
        try {
          db.execSync('ROLLBACK');
        } catch {}
        throw err;
      }
    },
    close() {
      try {
        db.closeSync();
      } catch {}
    },
  };
}

/**
 * Instantiates the appropriate SQLite driver depending on runtime environment.
 */
function createDriver(options?: { inMemory?: boolean; dbPath?: string }): SQLiteDriver {
  const isNode = typeof process !== 'undefined' && process.versions?.node && !process.env.EXPO_RUNTIME;

  if (isNode) {
    const targetPath = options?.inMemory ? ':memory:' : options?.dbPath || DATABASE_NAME;
    return createNodeDriver(targetPath);
  }

  return createExpoDriver(DATABASE_NAME);
}

/**
 * Executes versioned migrations on the database.
 */
function applyMigrations(driver: SQLiteDriver) {
  driver.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const currentVersionRow = driver.getFirst<{ version: number }>(
    'SELECT MAX(version) AS version FROM schema_version;'
  );
  const currentVersion = currentVersionRow?.version ?? 0;

  if (currentVersion < 1) {
    driver.transaction(() => {
      // 1. Tasks Table
      driver.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
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
          updated_at TEXT NOT NULL
        );
      `);

      driver.exec(`
        CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(scheduled_at);
        CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(is_completed);
        CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
      `);

      // 2. Daily Progress Table
      driver.exec(`
        CREATE TABLE IF NOT EXISTS daily_progress (
          date TEXT PRIMARY KEY,
          description TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          achievements TEXT NOT NULL DEFAULT '',
          next_steps TEXT NOT NULL DEFAULT '',
          linked_task INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 3. Task Notification Reminders Table
      driver.exec(`
        CREATE TABLE IF NOT EXISTS task_reminders (
          task_id INTEGER PRIMARY KEY,
          notification_id TEXT NOT NULL,
          trigger_time TEXT NOT NULL,
          offset_minutes INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );
      `);

      // 4. Products Table
      driver.exec(`
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          sku TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          price REAL NOT NULL DEFAULT 0,
          quantity INTEGER NOT NULL DEFAULT 0,
          reorder_level INTEGER NOT NULL DEFAULT 10,
          expiry_date TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      driver.exec(`
        CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
      `);

      driver.run(
        'INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?);',
        [1, new Date().toISOString()]
      );
    });
  }

  // Ensure products table exists if running on an existing DB
  driver.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      quantity INTEGER NOT NULL DEFAULT 0,
      reorder_level INTEGER NOT NULL DEFAULT 10,
      expiry_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
  `);
}

/**
 * Initializes the SQLite database and executes versioned schema migrations.
 * Safe to call multiple times (idempotent).
 */
export async function initDatabaseAsync(options?: {
  inMemory?: boolean;
  dbPath?: string;
  forceReset?: boolean;
}): Promise<SQLiteDriver> {
  if (activeDriver && !options?.forceReset && isInitialized) {
    return activeDriver;
  }

  if (activeDriver && options?.forceReset) {
    try {
      activeDriver.close();
    } catch {}
    activeDriver = null;
    isInitialized = false;
  }

  try {
    const driver = createDriver(options);
    applyMigrations(driver);
    activeDriver = driver;
    isInitialized = true;
    return driver;
  } catch (err) {
    console.error('[Database] Failed to initialize SQLite database:', err);
    throw new Error(`SQLite initialization failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Returns the active database driver. Initializes if not yet active.
 */
export function getDatabase(): SQLiteDriver {
  if (!activeDriver) {
    const isNode = typeof process !== 'undefined' && process.versions?.node && !process.env.EXPO_RUNTIME;
    activeDriver = createDriver({ inMemory: isNode });
    applyMigrations(activeDriver);
    isInitialized = true;
  }
  return activeDriver;
}

/**
 * Maps raw SQLite row to strongly typed Task object.
 */
export function mapRowToTask(row: Record<string, unknown>): Task {
  const isDone = Boolean(row.is_completed === 1 || row.is_completed === true || row.status === 'completed');
  return {
    id: Number(row.id),
    title: String(row.title || ''),
    description: String(row.description || ''),
    scheduled_at: row.scheduled_at ? String(row.scheduled_at) : null,
    end_at: row.end_at ? String(row.end_at) : null,
    priority: (row.priority as TaskPriority) || 'medium',
    status: (row.status as TaskStatus) || (isDone ? 'completed' : 'pending'),
    is_completed: isDone,
    notes: String(row.notes || ''),
    journal_entry: String(row.journal_entry || row.notes || row.description || ''),
    reminder_minutes: row.reminder_minutes != null ? Number(row.reminder_minutes) : null,
    created_at: String(row.created_at || new Date().toISOString()),
    updated_at: String(row.updated_at || new Date().toISOString()),
  };
}

// ============================================================================
// TASK CRUD OPERATIONS (100% Offline-First)
// ============================================================================

/**
 * Retrieves all tasks from SQLite sorted by high priority first, then chronologically.
 */
export async function getLocalTasksAsync(): Promise<Task[]> {
  const db = getDatabase();
  const rows = db.getAll<Record<string, unknown>>(`
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
  `);

  return rows.map(mapRowToTask);
}

/**
 * Retrieves a single task by ID.
 */
export async function getLocalTaskByIdAsync(id: number): Promise<Task | null> {
  const db = getDatabase();
  const row = db.getFirst<Record<string, unknown>>(
    'SELECT * FROM tasks WHERE id = ?;',
    [id]
  );
  return row ? mapRowToTask(row) : null;
}

/**
 * Creates a new task in local SQLite storage.
 * Performs validation, assigns stable ID, and sets timestamps.
 */
export async function createLocalTaskAsync(payload: {
  title: string;
  description?: string;
  scheduled_at?: string | null;
  end_at?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  is_completed?: boolean;
  notes?: string;
  journal_entry?: string;
  reminder_minutes?: number | null;
}): Promise<Task> {
  const title = (payload.title || '').trim();
  if (!title) {
    throw new Error('Task title cannot be empty.');
  }

  const priority: TaskPriority = ['low', 'medium', 'high'].includes(payload.priority || '')
    ? (payload.priority as TaskPriority)
    : 'medium';

  const status: TaskStatus = ['pending', 'in_progress', 'completed'].includes(payload.status || '')
    ? (payload.status as TaskStatus)
    : payload.is_completed
      ? 'completed'
      : 'pending';

  const isCompleted = status === 'completed' || Boolean(payload.is_completed);
  const nowIso = new Date().toISOString();
  const note = (payload.journal_entry || payload.notes || payload.description || '').trim();

  const db = getDatabase();
  const result = db.run(
    `INSERT INTO tasks (
      title, description, scheduled_at, end_at, priority, status,
      is_completed, notes, journal_entry, reminder_minutes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      title,
      note,
      payload.scheduled_at || null,
      payload.end_at || null,
      priority,
      status,
      isCompleted ? 1 : 0,
      note,
      note,
      payload.reminder_minutes ?? null,
      nowIso,
      nowIso,
    ]
  );

  const created = await getLocalTaskByIdAsync(result.lastInsertRowId);
  if (!created) {
    throw new Error('Failed to retrieve newly created task from SQLite.');
  }
  return created;
}

/**
 * Updates an existing task in local SQLite storage.
 */
export async function updateLocalTaskAsync(
  id: number,
  updates: {
    title?: string;
    description?: string;
    scheduled_at?: string | null;
    end_at?: string | null;
    priority?: TaskPriority;
    status?: TaskStatus;
    is_completed?: boolean;
    notes?: string;
    journal_entry?: string;
    reminder_minutes?: number | null;
  }
): Promise<Task> {
  const existing = await getLocalTaskByIdAsync(id);
  if (!existing) {
    throw new Error(`Task with id ${id} not found.`);
  }

  const title = updates.title !== undefined ? updates.title.trim() : existing.title;
  if (!title) {
    throw new Error('Task title cannot be empty.');
  }

  const priority = updates.priority || existing.priority;
  let status = updates.status || existing.status || 'pending';
  if (updates.is_completed !== undefined) {
    status = updates.is_completed ? 'completed' : 'pending';
  }
  const isCompleted = status === 'completed' || Boolean(updates.is_completed);

  const note = (updates.journal_entry ?? updates.notes ?? updates.description ?? existing.notes ?? '').trim();
  const scheduledAt = updates.scheduled_at !== undefined ? updates.scheduled_at : existing.scheduled_at;
  const endAt = updates.end_at !== undefined ? updates.end_at : existing.end_at;
  const reminderMinutes = updates.reminder_minutes !== undefined ? updates.reminder_minutes : existing.reminder_minutes;
  const nowIso = new Date().toISOString();

  const db = getDatabase();
  db.run(
    `UPDATE tasks SET
      title = ?,
      description = ?,
      scheduled_at = ?,
      end_at = ?,
      priority = ?,
      status = ?,
      is_completed = ?,
      notes = ?,
      journal_entry = ?,
      reminder_minutes = ?,
      updated_at = ?
    WHERE id = ?;`,
    [
      title,
      note,
      scheduledAt,
      endAt,
      priority,
      status,
      isCompleted ? 1 : 0,
      note,
      note,
      reminderMinutes ?? null,
      nowIso,
      id,
    ]
  );

  const updated = await getLocalTaskByIdAsync(id);
  if (!updated) {
    throw new Error(`Failed to retrieve updated task ${id}.`);
  }
  return updated;
}

/**
 * Atomically toggles completion status for a task in local SQLite storage.
 */
export async function toggleLocalTaskCompletionAsync(id: number): Promise<Task> {
  const db = getDatabase();
  return db.transaction(() => {
    const existing = db.getFirst<Record<string, unknown>>(
      'SELECT is_completed FROM tasks WHERE id = ?;',
      [id]
    );
    if (!existing) {
      throw new Error(`Task with id ${id} not found.`);
    }

    const currentCompleted = Number(existing.is_completed) === 1;
    const nextCompleted = !currentCompleted;
    const nextStatus: TaskStatus = nextCompleted ? 'completed' : 'pending';
    const nowIso = new Date().toISOString();

    db.run(
      'UPDATE tasks SET is_completed = ?, status = ?, updated_at = ? WHERE id = ?;',
      [nextCompleted ? 1 : 0, nextStatus, nowIso, id]
    );

    const updated = db.getFirst<Record<string, unknown>>(
      'SELECT * FROM tasks WHERE id = ?;',
      [id]
    );
    return mapRowToTask(updated!);
  });
}

/**
 * Deletes a task and removes any associated notification reminder.
 */
export async function deleteLocalTaskAsync(id: number): Promise<boolean> {
  const db = getDatabase();
  return db.transaction(() => {
    db.run('DELETE FROM task_reminders WHERE task_id = ?;', [id]);
    const res = db.run('DELETE FROM tasks WHERE id = ?;', [id]);
    return res.changes > 0;
  });
}

/**
 * Bulk seed or import tasks into local SQLite without deleting or overwriting
 * existing newer local data.
 */
export async function importTasksIntoLocalDbAsync(incomingTasks: Task[]): Promise<number> {
  if (!Array.isArray(incomingTasks) || incomingTasks.length === 0) {
    return 0;
  }

  const db = getDatabase();
  let importedCount = 0;

  db.transaction(() => {
    for (const t of incomingTasks) {
      const existing = db.getFirst<Record<string, unknown>>(
        'SELECT id, updated_at FROM tasks WHERE id = ?;',
        [t.id]
      );

      const note = (t.journal_entry || t.notes || t.description || '').trim();
      const isCompleted = t.is_completed || t.status === 'completed';
      const nowIso = new Date().toISOString();

      if (!existing) {
        db.run(
          `INSERT INTO tasks (
            id, title, description, scheduled_at, end_at, priority, status,
            is_completed, notes, journal_entry, reminder_minutes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            t.id,
            t.title,
            note,
            t.scheduled_at || null,
            t.end_at || null,
            t.priority || 'medium',
            t.status || (isCompleted ? 'completed' : 'pending'),
            isCompleted ? 1 : 0,
            note,
            note,
            t.reminder_minutes ?? null,
            t.created_at || nowIso,
            t.updated_at || nowIso,
          ]
        );
        importedCount++;
      }
    }
  });

  return importedCount;
}

// ============================================================================
// DAILY PROGRESS JOURNAL (100% Offline-First)
// ============================================================================

/**
 * Retrieves daily progress entry for a given calendar date (YYYY-MM-DD).
 */
export async function getLocalDailyProgressAsync(date: string): Promise<DailyProgress | null> {
  const db = getDatabase();
  const row = db.getFirst<Record<string, unknown>>(
    'SELECT * FROM daily_progress WHERE date = ?;',
    [date]
  );
  if (!row) return null;

  return {
    date: String(row.date),
    description: String(row.description || ''),
    notes: String(row.notes || ''),
    achievements: String(row.achievements || ''),
    next_steps: String(row.next_steps || ''),
    linked_task: row.linked_task != null ? Number(row.linked_task) : null,
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

/**
 * Retrieves all daily progress entries from local SQLite.
 */
export async function getAllLocalDailyProgressAsync(): Promise<DailyProgress[]> {
  const db = getDatabase();
  const rows = db.getAll<Record<string, unknown>>(
    'SELECT * FROM daily_progress ORDER BY date DESC;'
  );

  return rows.map(row => ({
    date: String(row.date),
    description: String(row.description || ''),
    notes: String(row.notes || ''),
    achievements: String(row.achievements || ''),
    next_steps: String(row.next_steps || ''),
    linked_task: row.linked_task != null ? Number(row.linked_task) : null,
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  }));
}

/**
 * Saves or updates a daily progress journal entry in local SQLite storage.
 */
export async function saveLocalDailyProgressAsync(progress: DailyProgress): Promise<DailyProgress> {
  const dateKey = progress.date || getLocalDateString();
  const nowIso = new Date().toISOString();
  const db = getDatabase();

  db.transaction(() => {
    const existing = db.getFirst<Record<string, unknown>>(
      'SELECT date, description, created_at FROM daily_progress WHERE date = ?;',
      [dateKey]
    );

    if (existing) {
      db.run(
        `UPDATE daily_progress SET
          description = ?,
          notes = ?,
          achievements = ?,
          next_steps = ?,
          linked_task = ?,
          updated_at = ?
        WHERE date = ?;`,
        [
          progress.description || '',
          progress.notes || '',
          progress.achievements || '',
          progress.next_steps || '',
          progress.linked_task ?? null,
          nowIso,
          dateKey,
        ]
      );
    } else {
      db.run(
        `INSERT INTO daily_progress (
          date, description, notes, achievements, next_steps, linked_task, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          dateKey,
          progress.description || '',
          progress.notes || '',
          progress.achievements || '',
          progress.next_steps || '',
          progress.linked_task ?? null,
          nowIso,
          nowIso,
        ]
      );
    }
  });

  const saved = await getLocalDailyProgressAsync(dateKey);
  return saved!;
}

// ============================================================================
// NOTIFICATION REMINDER PERSISTENCE
// ============================================================================

/**
 * Saves a scheduled notification identifier linked to a task in SQLite.
 */
export async function saveTaskReminderRecordAsync(record: {
  taskId: number;
  notificationId: string;
  triggerTime: string;
  offsetMinutes: number;
}): Promise<void> {
  const db = getDatabase();
  const nowIso = new Date().toISOString();
  db.run(
    `INSERT OR REPLACE INTO task_reminders (
      task_id, notification_id, trigger_time, offset_minutes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?);`,
    [
      record.taskId,
      record.notificationId,
      record.triggerTime,
      record.offsetMinutes,
      nowIso,
      nowIso,
    ]
  );
}

/**
 * Retrieves the saved reminder record for a given task ID.
 */
export async function getTaskReminderRecordAsync(taskId: number): Promise<TaskReminderRecord | null> {
  const db = getDatabase();
  const row = db.getFirst<Record<string, unknown>>(
    'SELECT * FROM task_reminders WHERE task_id = ?;',
    [taskId]
  );
  if (!row) return null;

  return {
    task_id: Number(row.task_id),
    notification_id: String(row.notification_id),
    trigger_time: String(row.trigger_time),
    offset_minutes: Number(row.offset_minutes),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

/**
 * Deletes a reminder record from local SQLite.
 */
export async function deleteTaskReminderRecordAsync(taskId: number): Promise<void> {
  const db = getDatabase();
  db.run('DELETE FROM task_reminders WHERE task_id = ?;', [taskId]);
}

/**
 * Retrieves all saved reminder records from local SQLite.
 */
export async function getAllTaskReminderRecordsAsync(): Promise<TaskReminderRecord[]> {
  const db = getDatabase();
  const rows = db.getAll<Record<string, unknown>>(
    'SELECT * FROM task_reminders;'
  );
  return rows.map(r => ({
    task_id: Number(r.task_id),
    notification_id: String(r.notification_id),
    trigger_time: String(r.trigger_time),
    offset_minutes: Number(r.offset_minutes),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  }));
}

// ============================================================================
// PRODUCT CRUD OPERATIONS (Offline-First Persistence)
// ============================================================================

export interface LocalProduct {
  id: number;
  name: string;
  sku: string;
  category: string;
  description?: string;
  quantity: number;
  reorder_level: number;
  price: number | string;
  expiry_date?: string | null;
  created_at?: string;
  updated_at?: string;
}

export function mapRowToProduct(row: Record<string, unknown>): LocalProduct {
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    sku: String(row.sku || ''),
    category: String(row.category || ''),
    description: String(row.description || ''),
    price: Number(row.price || 0),
    quantity: Number(row.quantity || 0),
    reorder_level: Number(row.reorder_level ?? 10),
    expiry_date: row.expiry_date ? String(row.expiry_date) : null,
    created_at: String(row.created_at || new Date().toISOString()),
    updated_at: String(row.updated_at || new Date().toISOString()),
  };
}

/**
 * Retrieves all products from local SQLite storage.
 */
export async function getLocalProductsAsync(): Promise<LocalProduct[]> {
  const db = getDatabase();
  const rows = db.getAll<Record<string, unknown>>('SELECT * FROM products ORDER BY name ASC;');
  return rows.map(mapRowToProduct);
}

/**
 * Imports backend products into local SQLite database.
 */
export async function importProductsIntoLocalDbAsync(products: LocalProduct[]): Promise<void> {
  if (!products || products.length === 0) return;
  const db = getDatabase();
  db.transaction(() => {
    for (const p of products) {
      db.run(
        `INSERT OR REPLACE INTO products (id, name, sku, category, description, price, quantity, reorder_level, expiry_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          p.id,
          p.name,
          p.sku,
          p.category || '',
          p.description || '',
          Number(p.price || 0),
          Number(p.quantity || 0),
          Number(p.reorder_level ?? 10),
          p.expiry_date || null,
          p.created_at || new Date().toISOString(),
          p.updated_at || new Date().toISOString(),
        ]
      );
    }
  });
}

/**
 * Saves or updates a single product in local SQLite storage.
 */
export async function saveLocalProductAsync(p: LocalProduct): Promise<LocalProduct> {
  const db = getDatabase();
  const now = new Date().toISOString();
  let productId = p.id;
  if (!productId || productId <= 0) {
    const minRow = db.getFirst<{ minId: number | null }>('SELECT MIN(id) as minId FROM products;');
    const minVal = minRow?.minId ?? 0;
    productId = minVal < 0 ? minVal - 1 : -1;
  }
  db.run(
    `INSERT OR REPLACE INTO products (id, name, sku, category, description, price, quantity, reorder_level, expiry_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      productId,
      p.name,
      p.sku,
      p.category || '',
      p.description || '',
      Number(p.price || 0),
      Number(p.quantity || 0),
      Number(p.reorder_level ?? 10),
      p.expiry_date || null,
      p.created_at || now,
      now,
    ]
  );
  return { ...p, id: productId };
}

/**
 * Updates stock quantity for a product in local SQLite.
 */
export async function updateLocalProductQuantityAsync(id: number, quantity: number): Promise<void> {
  const db = getDatabase();
  db.run('UPDATE products SET quantity = ?, updated_at = ? WHERE id = ?;', [
    quantity,
    new Date().toISOString(),
    id,
  ]);
}

/**
 * Deletes a product from local SQLite storage.
 */
export async function deleteLocalProductAsync(id: number): Promise<void> {
  const db = getDatabase();
  db.run('DELETE FROM products WHERE id = ?;', [id]);
}

