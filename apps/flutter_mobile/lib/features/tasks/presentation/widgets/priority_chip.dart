import 'package:flutter/material.dart';
import '../../../../core/config/app_theme.dart';
import '../../models/task.dart';

class PriorityChip extends StatelessWidget {
  final TaskPriority priority;
  final bool isCompact;

  const PriorityChip({
    super.key,
    required this.priority,
    this.isCompact = false,
  });

  @override
  Widget build(BuildContext context) {
    Color color;
    String label;

    switch (priority) {
      case TaskPriority.high:
        color = AppColors.priorityHigh;
        label = 'High';
        break;
      case TaskPriority.medium:
        color = AppColors.priorityMedium;
        label = 'Medium';
        break;
      case TaskPriority.low:
        color = AppColors.priorityLow;
        label = 'Low';
        break;
    }

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: isCompact ? 6 : 10,
        vertical: isCompact ? 2 : 4,
      ),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.3), width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: isCompact ? 11 : 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
