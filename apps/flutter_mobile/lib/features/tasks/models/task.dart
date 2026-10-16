enum TaskPriority { low, medium, high }

enum TaskStatus { pending, inProgress, completed }

extension TaskPriorityExtension on TaskPriority {
  String get value {
    switch (this) {
      case TaskPriority.low:
        return 'low';
      case TaskPriority.medium:
        return 'medium';
      case TaskPriority.high:
        return 'high';
    }
  }

  static TaskPriority fromString(String? val) {
    switch (val?.toLowerCase().trim()) {
      case 'high':
        return TaskPriority.high;
      case 'low':
        return TaskPriority.low;
      case 'medium':
      default:
        return TaskPriority.medium;
    }
  }

  int get rank {
    switch (this) {
      case TaskPriority.high:
        return 1;
      case TaskPriority.medium:
        return 2;
      case TaskPriority.low:
        return 3;
    }
  }
}

extension TaskStatusExtension on TaskStatus {
  String get value {
    switch (this) {
      case TaskStatus.pending:
        return 'pending';
      case TaskStatus.inProgress:
        return 'in_progress';
      case TaskStatus.completed:
        return 'completed';
    }
  }

  static TaskStatus fromString(String? val) {
    switch (val?.toLowerCase().trim()) {
      case 'completed':
        return TaskStatus.completed;
      case 'in_progress':
        return TaskStatus.inProgress;
      case 'pending':
      default:
        return TaskStatus.pending;
    }
  }
}

class Task {
  final int id;
  final String title;
  final String description;
  final String? scheduledAt; // UTC ISO-8601
  final String? endAt;
  final TaskPriority priority;
  final TaskStatus status;
  final bool isCompleted;
  final String notes;
  final String journalEntry;
  final int? reminderMinutes;
  final String? createdAt;
  final String? updatedAt;
  final bool isSynced;
  final Map<String, dynamic>? dailyProgress;

  const Task({
    required this.id,
    required this.title,
    this.description = '',
    this.scheduledAt,
    this.endAt,
    this.priority = TaskPriority.medium,
    this.status = TaskStatus.pending,
    this.isCompleted = false,
    this.notes = '',
    this.journalEntry = '',
    this.reminderMinutes,
    this.createdAt,
    this.updatedAt,
    this.isSynced = true,
    this.dailyProgress,
  });

  bool get isDone => isCompleted || status == TaskStatus.completed;

  DateTime? get localScheduledDateTime {
    if (scheduledAt == null || scheduledAt!.isEmpty) return null;
    try {
      return DateTime.parse(scheduledAt!).toLocal();
    } catch (_) {
      return null;
    }
  }

  DateTime? get localEndDateTime {
    if (endAt == null || endAt!.isEmpty) return null;
    try {
      return DateTime.parse(endAt!).toLocal();
    } catch (_) {
      return null;
    }
  }

  String? get localDateString {
    final dt = localScheduledDateTime;
    if (dt == null) return null;
    final y = dt.year;
    final m = dt.month.toString().padLeft(2, '0');
    final d = dt.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  static String nowDateString([DateTime? dt]) {
    final d = dt ?? DateTime.now();
    final y = d.year;
    final m = d.month.toString().padLeft(2, '0');
    final day = d.day.toString().padLeft(2, '0');
    return '$y-$m-$day';
  }

  bool get isOverdue {
    if (isDone) return false;
    final dt = localScheduledDateTime;
    if (dt == null) return false;
    return dt.isBefore(DateTime.now());
  }

  bool isToday([DateTime? now]) {
    final dt = localScheduledDateTime;
    if (dt == null) return false;
    final current = now ?? DateTime.now();
    return dt.year == current.year &&
        dt.month == current.month &&
        dt.day == current.day;
  }

  bool isUpcoming([DateTime? now]) {
    final dt = localScheduledDateTime;
    if (dt == null) return false;
    final current = now ?? DateTime.now();
    final todayMidnight = DateTime(current.year, current.month, current.day);
    final tomorrowMidnight = todayMidnight.add(const Duration(days: 1));
    return dt.isAfter(tomorrowMidnight) || dt.isAtSameMomentAs(tomorrowMidnight);
  }

  Task copyWith({
    int? id,
    String? title,
    String? description,
    String? scheduledAt,
    String? endAt,
    TaskPriority? priority,
    TaskStatus? status,
    bool? isCompleted,
    String? notes,
    String? journalEntry,
    int? reminderMinutes,
    String? createdAt,
    String? updatedAt,
    bool? isSynced,
    Map<String, dynamic>? dailyProgress,
  }) {
    return Task(
      id: id ?? this.id,
      title: title ?? this.title,
      description: description ?? this.description,
      scheduledAt: scheduledAt ?? this.scheduledAt,
      endAt: endAt ?? this.endAt,
      priority: priority ?? this.priority,
      status: status ?? this.status,
      isCompleted: isCompleted ?? this.isCompleted,
      notes: notes ?? this.notes,
      journalEntry: journalEntry ?? this.journalEntry,
      reminderMinutes: reminderMinutes ?? this.reminderMinutes,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      isSynced: isSynced ?? this.isSynced,
      dailyProgress: dailyProgress ?? this.dailyProgress,
    );
  }

  factory Task.fromJson(Map<String, dynamic> json) {
    final rawStatus = json['status']?.toString();
    final rawCompleted = json['is_completed'];
    final isDone = rawCompleted == true ||
        rawCompleted == 1 ||
        rawStatus?.toLowerCase() == 'completed';

    return Task(
      id: json['id'] is int ? json['id'] as int : int.tryParse('${json['id']}') ?? 0,
      title: json['title']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      scheduledAt: json['scheduled_at']?.toString(),
      endAt: json['end_at']?.toString(),
      priority: TaskPriorityExtension.fromString(json['priority']?.toString()),
      status: TaskStatusExtension.fromString(rawStatus ?? (isDone ? 'completed' : 'pending')),
      isCompleted: isDone,
      notes: json['notes']?.toString() ?? '',
      journalEntry: json['journal_entry']?.toString() ??
          json['notes']?.toString() ??
          json['description']?.toString() ??
          '',
      reminderMinutes: json['reminder_minutes'] != null
          ? int.tryParse('${json['reminder_minutes']}')
          : null,
      createdAt: json['created_at']?.toString(),
      updatedAt: json['updated_at']?.toString(),
      isSynced: true,
      dailyProgress: json['daily_progress'] as Map<String, dynamic>?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'title': title,
      'description': description,
      'scheduled_at': scheduledAt,
      'end_at': endAt,
      'priority': priority.value,
      'status': status.value,
      'is_completed': isCompleted,
      'notes': notes,
      'reminder_minutes': reminderMinutes,
    };
  }

  Map<String, dynamic> toSqliteMap() {
    return {
      'id': id,
      'title': title,
      'description': description,
      'scheduled_at': scheduledAt,
      'end_at': endAt,
      'priority': priority.value,
      'status': status.value,
      'is_completed': isCompleted ? 1 : 0,
      'notes': notes,
      'journal_entry': journalEntry,
      'reminder_minutes': reminderMinutes,
      'created_at': createdAt,
      'updated_at': updatedAt,
      'is_synced': isSynced ? 1 : 0,
    };
  }

  factory Task.fromSqliteMap(Map<String, dynamic> map) {
    final isDone = (map['is_completed'] as int? ?? 0) == 1 ||
        map['status']?.toString().toLowerCase() == 'completed';

    return Task(
      id: map['id'] as int,
      title: map['title'] as String? ?? '',
      description: map['description'] as String? ?? '',
      scheduledAt: map['scheduled_at'] as String?,
      endAt: map['end_at'] as String?,
      priority: TaskPriorityExtension.fromString(map['priority'] as String?),
      status: TaskStatusExtension.fromString(map['status'] as String? ?? (isDone ? 'completed' : 'pending')),
      isCompleted: isDone,
      notes: map['notes'] as String? ?? '',
      journalEntry: map['journal_entry'] as String? ??
          map['notes'] as String? ??
          map['description'] as String? ??
          '',
      reminderMinutes: map['reminder_minutes'] as int?,
      createdAt: map['created_at'] as String?,
      updatedAt: map['updated_at'] as String?,
      isSynced: (map['is_synced'] as int? ?? 1) == 1,
    );
  }
}
