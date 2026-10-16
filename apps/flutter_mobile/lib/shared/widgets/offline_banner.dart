import 'package:flutter/material.dart';

class OfflineBanner extends StatelessWidget {
  final bool isOffline;
  final int pendingCount;
  final int? pendingSyncCount;
  final VoidCallback? onSyncNow;
  final VoidCallback? onSyncTap;

  const OfflineBanner({
    super.key,
    required this.isOffline,
    this.pendingCount = 0,
    this.pendingSyncCount,
    this.onSyncNow,
    this.onSyncTap,
  });

  int get _actualPendingCount => pendingSyncCount ?? pendingCount;
  VoidCallback? get _actualSyncTap => onSyncTap ?? onSyncNow;

  @override
  Widget build(BuildContext context) {
    if (!isOffline && _actualPendingCount == 0) {
      return const SizedBox.shrink();
    }

    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bgColor = isOffline
        ? (isDark ? const Color(0xFF7F1D1D) : const Color(0xFFFEE2E2))
        : (isDark ? const Color(0xFF78350F) : const Color(0xFFFEF3C7));
    final textColor = isOffline
        ? (isDark ? const Color(0xFFFCA5A5) : const Color(0xFF991B1B))
        : (isDark ? const Color(0xFFFDE68A) : const Color(0xFF92400E));

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      color: bgColor,
      child: Row(
        children: [
          Icon(
            isOffline ? Icons.cloud_off_rounded : Icons.sync_rounded,
            size: 18,
            color: textColor,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              isOffline
                  ? 'Offline Mode: Changes saved locally'
                  : '$_actualPendingCount changes queued for cloud sync',
              style: TextStyle(
                color: textColor,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          if (_actualSyncTap != null && !isOffline)
            TextButton(
              onPressed: _actualSyncTap,
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: Text(
                'Sync',
                style: TextStyle(
                  color: textColor,
                  fontSize: 13,
                  fontWeight: FontWeight.bold,
                  decoration: TextDecoration.underline,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
