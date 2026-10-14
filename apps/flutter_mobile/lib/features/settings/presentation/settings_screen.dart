import 'package:flutter/material.dart';
import '../../../../core/config/api_config.dart';
import '../../../../core/config/app_theme.dart';
import '../../../../core/network/network_info.dart';
import '../../../../core/storage/secure_storage.dart';
import '../../auth/services/installation_service.dart';
import '../../inventory/services/inventory_repository.dart';
import '../../tasks/services/task_repository.dart';

class SettingsScreen extends StatefulWidget {
  final TaskRepository taskRepository;
  final InventoryRepository inventoryRepository;
  final NetworkInfo networkInfo;

  const SettingsScreen({
    super.key,
    required this.taskRepository,
    required this.inventoryRepository,
    required this.networkInfo,
  });

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  String? _installationId;
  bool _isOnline = false;
  int _pendingTaskSyncCount = 0;
  int _pendingInventorySyncCount = 0;
  bool _isSyncing = false;
  String _syncResult = '';

  @override
  void initState() {
    super.initState();
    _loadStatus();
  }

  Future<void> _loadStatus() async {
    final creds = await SecureStorage.getInstallationCredentials();
    final connected = await widget.networkInfo.isConnected;
    final taskPending = await widget.taskRepository.getPendingSyncCount();
    final invPending = await widget.inventoryRepository.getPendingSyncCount();

    if (mounted) {
      setState(() {
        _installationId = creds?.installationId ?? 'Not registered';
        _isOnline = connected;
        _pendingTaskSyncCount = taskPending;
        _pendingInventorySyncCount = invPending;
      });
    }
  }

  Future<void> _triggerManualSync() async {
    setState(() {
      _isSyncing = true;
      _syncResult = 'Syncing data with cloud...';
    });

    try {
      final taskSync = await widget.taskRepository.syncQueueNow();
      final invSync = await widget.inventoryRepository.syncPendingQueue();

      setState(() {
        _isSyncing = false;
        _syncResult = 'Sync complete! Reconciled $taskSync tasks and $invSync products.';
      });
      _loadStatus();
    } catch (e) {
      setState(() {
        _isSyncing = false;
        _syncResult = 'Sync failed: $e';
      });
    }
  }

  Future<void> _reconnectBackend() async {
    setState(() {
      _isSyncing = true;
      _syncResult = 'Re-bootstrapping installation credentials...';
    });

    try {
      final instService = InstallationService();
      final creds = await instService.bootstrapInstallation(forceNew: true);
      setState(() {
        _isSyncing = false;
        _installationId = creds.installationId;
        _syncResult = 'Handshake successful with Django REST backend!';
      });
    } catch (e) {
      setState(() {
        _isSyncing = false;
        _syncResult = 'Handshake error: $e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Status & Settings'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Connection Status Card
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        _isOnline ? Icons.cloud_done_rounded : Icons.cloud_off_rounded,
                        color: _isOnline ? AppColors.success : AppColors.warning,
                        size: 24,
                      ),
                      const SizedBox(width: 12),
                      Text(
                        _isOnline ? 'Online (Connected)' : 'Offline Mode',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: _isOnline ? AppColors.success : AppColors.warning,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  const Divider(),
                  const SizedBox(height: 8),
                  Text(
                    'Backend API Endpoint',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    ApiConfig.baseUrl,
                    style: TextStyle(
                      fontSize: 13,
                      fontFamily: 'monospace',
                      color: isDark ? AppColors.darkText : AppColors.lightText,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Device Installation ID',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _installationId ?? 'Loading...',
                    style: TextStyle(
                      fontSize: 13,
                      fontFamily: 'monospace',
                      color: isDark ? AppColors.darkText : AppColors.lightText,
                    ),
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 16),

          // Offline Queue Card
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Offline Sync Queue',
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: isDark ? AppColors.darkText : AppColors.lightText,
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: (_pendingTaskSyncCount + _pendingInventorySyncCount > 0)
                              ? AppColors.warning.withOpacity(0.15)
                              : AppColors.success.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          '${_pendingTaskSyncCount + _pendingInventorySyncCount} pending',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: (_pendingTaskSyncCount + _pendingInventorySyncCount > 0)
                                ? AppColors.warning
                                : AppColors.success,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Tasks pending upload: $_pendingTaskSyncCount\nInventory operations pending: $_pendingInventorySyncCount',
                    style: TextStyle(
                      fontSize: 13,
                      height: 1.5,
                      color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                    ),
                  ),
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: _isSyncing ? null : _triggerManualSync,
                      icon: _isSyncing
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Icon(Icons.sync_rounded, size: 18),
                      label: Text(_isSyncing ? 'Syncing...' : 'Sync Cloud Now'),
                    ),
                  ),
                  if (_syncResult.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Text(
                      _syncResult,
                      style: const TextStyle(fontSize: 12, color: AppColors.primary),
                    ),
                  ],
                ],
              ),
            ),
          ),

          const SizedBox(height: 16),

          // Diagnostic Actions
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Diagnostics & Auth',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: isDark ? AppColors.darkText : AppColors.lightText,
                    ),
                  ),
                  const SizedBox(height: 10),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.refresh_rounded, color: AppColors.primary),
                    title: const Text('Refresh Credentials'),
                    subtitle: const Text('Re-negotiate verified installation tokens with backend'),
                    onTap: _reconnectBackend,
                  ),
                  const Divider(),
                  const ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(Icons.notifications_active_outlined, color: AppColors.primary),
                    title: Text('Notification Channels'),
                    subtitle: Text('Stock alerts & Task reminder channels active'),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
