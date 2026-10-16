import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/config/app_theme.dart';
import '../../models/task.dart';
import 'priority_chip.dart';

class TaskCard extends StatelessWidget {
  final Task task;
  final ValueChanged<bool> onToggleComplete;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const TaskCard({
    super.key,
    required this.task,
    required this.onToggleComplete,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
  });

  String _formatSchedule(Task task) {
    final dt = task.localScheduledDateTime;
    if (dt == null) return 'No due date';
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final taskDay = DateTime(dt.year, dt.month, dt.day);

    final timeStr = DateFormat('h:mm a').format(dt);

    if (taskDay == today) {
      return 'Today, $timeStr';
    } else if (taskDay == today.add(const Duration(days: 1))) {
      return 'Tomorrow, $timeStr';
    } else if (taskDay == today.subtract(const Duration(days: 1))) {
      return 'Yesterday, $timeStr';
    } else {
      return DateFormat('MMM d, h:mm a').format(dt);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final isDone = task.isDone;
    final isOverdue = task.isOverdue;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
      decoration: BoxDecoration(
        color: isDark ? AppColors.darkSurface : AppColors.lightSurface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isOverdue
              ? AppColors.danger.withOpacity(0.4)
              : (isDark ? AppColors.darkBorder : AppColors.lightBorder),
          width: isOverdue ? 1.5 : 1.0,
        ),
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Checkbox
                Padding(
                  padding: const EdgeInsets.only(top: 2, right: 10),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(20),
                    onTap: () => onToggleComplete(!isDone),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      width: 24,
                      height: 24,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: isDone ? AppColors.success : Colors.transparent,
                        border: Border.all(
                          color: isDone
                              ? AppColors.success
                              : (isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary),
                          width: 2,
                        ),
                      ),
                      child: isDone
                          ? const Icon(
                              Icons.check,
                              size: 16,
                              color: Colors.white,
                            )
                          : null,
                    ),
                  ),
                ),

                // Content
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Title & Sync Icon
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              task.title,
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w600,
                                decoration: isDone ? TextDecoration.lineThrough : null,
                                color: isDone
                                    ? (isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary)
                                    : (isDark ? AppColors.darkText : AppColors.lightText),
                              ),
                            ),
                          ),
                          if (!task.isSynced)
                            Padding(
                              padding: const EdgeInsets.only(left: 6),
                              child: Tooltip(
                                message: 'Saved locally, pending cloud sync',
                                child: Container(
                                  padding: const EdgeInsets.all(2),
                                  decoration: BoxDecoration(
                                    color: AppColors.warning.withOpacity(0.15),
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: const Icon(
                                    Icons.cloud_upload_outlined,
                                    size: 14,
                                    color: AppColors.warning,
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),

                      if (task.description.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          task.description,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 13,
                            color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                          ),
                        ),
                      ],

                      const SizedBox(height: 10),

                      // Metadata Footer
                      Row(
                        children: [
                          PriorityChip(priority: task.priority, isCompact: true),
                          const SizedBox(width: 8),

                          // Schedule info
                          Icon(
                            isOverdue ? Icons.warning_amber_rounded : Icons.access_time_rounded,
                            size: 14,
                            color: isOverdue
                                ? AppColors.danger
                                : (isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            _formatSchedule(task),
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: isOverdue ? FontWeight.w600 : FontWeight.w400,
                              color: isOverdue
                                  ? AppColors.danger
                                  : (isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary),
                            ),
                          ),

                          if (task.reminderMinutes != null && task.reminderMinutes! > 0) ...[
                            const SizedBox(width: 8),
                            const Icon(
                              Icons.notifications_active_outlined,
                              size: 13,
                              color: AppColors.primary,
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),

                // Action Menu
                PopupMenuButton<String>(
                  icon: Icon(
                    Icons.more_vert,
                    size: 20,
                    color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                  ),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  onSelected: (value) {
                    if (value == 'edit') {
                      onEdit();
                    } else if (value == 'delete') {
                      onDelete();
                    }
                  },
                  itemBuilder: (context) => [
                    const PopupMenuItem(
                      value: 'edit',
                      child: Row(
                        children: [
                          Icon(Icons.edit_outlined, size: 18),
                          SizedBox(width: 8),
                          Text('Edit Task'),
                        ],
                      ),
                    ),
                    const PopupMenuItem(
                      value: 'delete',
                      child: Row(
                        children: [
                          Icon(Icons.delete_outline, size: 18, color: AppColors.danger),
                          SizedBox(width: 8),
                          Text('Delete', style: TextStyle(color: AppColors.danger)),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
