class DailyProgress {
  final String date; // YYYY-MM-DD
  final String description;
  final String notes;
  final String achievements;
  final String nextSteps;
  final int? linkedTask;
  final String? createdAt;
  final String? updatedAt;
  final bool isSynced;

  const DailyProgress({
    required this.date,
    this.description = '',
    this.notes = '',
    this.achievements = '',
    this.nextSteps = '',
    this.linkedTask,
    this.createdAt,
    this.updatedAt,
    this.isSynced = true,
  });

  String get journalNotes => notes.isNotEmpty ? notes : description;

  DailyProgress copyWith({
    String? date,
    String? description,
    String? notes,
    String? achievements,
    String? nextSteps,
    int? linkedTask,
    String? createdAt,
    String? updatedAt,
    bool? isSynced,
  }) {
    return DailyProgress(
      date: date ?? this.date,
      description: description ?? this.description,
      notes: notes ?? this.notes,
      achievements: achievements ?? this.achievements,
      nextSteps: nextSteps ?? this.nextSteps,
      linkedTask: linkedTask ?? this.linkedTask,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      isSynced: isSynced ?? this.isSynced,
    );
  }

  factory DailyProgress.fromJson(Map<String, dynamic> json) {
    return DailyProgress(
      date: json['date']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      notes: json['notes']?.toString() ?? '',
      achievements: json['achievements']?.toString() ?? '',
      nextSteps: json['next_steps']?.toString() ?? '',
      linkedTask: json['linked_task'] != null ? int.tryParse('${json['linked_task']}') : null,
      createdAt: json['created_at']?.toString(),
      updatedAt: json['updated_at']?.toString(),
      isSynced: true,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'date': date,
      'description': description,
      'notes': notes,
      'achievements': achievements,
      'next_steps': nextSteps,
      'linked_task': linkedTask,
    };
  }

  Map<String, dynamic> toSqliteMap() {
    return {
      'date': date,
      'description': description,
      'notes': notes,
      'achievements': achievements,
      'next_steps': nextSteps,
      'linked_task': linkedTask,
      'created_at': createdAt ?? DateTime.now().toIso8601String(),
      'updated_at': updatedAt ?? DateTime.now().toIso8601String(),
      'is_synced': isSynced ? 1 : 0,
    };
  }

  factory DailyProgress.fromSqliteMap(Map<String, dynamic> map) {
    return DailyProgress(
      date: map['date'] as String,
      description: map['description'] as String? ?? '',
      notes: map['notes'] as String? ?? '',
      achievements: map['achievements'] as String? ?? '',
      nextSteps: map['next_steps'] as String? ?? '',
      linkedTask: map['linked_task'] as int?,
      createdAt: map['created_at'] as String?,
      updatedAt: map['updated_at'] as String?,
      isSynced: (map['is_synced'] as int? ?? 1) == 1,
    );
  }
}
