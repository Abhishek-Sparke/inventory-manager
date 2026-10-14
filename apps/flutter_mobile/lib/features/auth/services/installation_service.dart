import 'dart:io';
import 'package:stockflow_mobile/core/config/api_config.dart';
import 'package:stockflow_mobile/core/network/api_client.dart';
import 'package:stockflow_mobile/core/storage/secure_storage.dart';
import 'package:stockflow_mobile/features/auth/models/installation.dart';

class InstallationService {
  final ApiClient _apiClient;
  final SecureStorageService _storage;
  InstallationCredentials? _cachedCredentials;

  InstallationService({ApiClient? apiClient, SecureStorageService? storage})
      : _apiClient = apiClient ?? ApiClient(),
        _storage = storage ?? SecureStorageService();

  Future<InstallationCredentials> getCredentials({String? deviceName}) =>
      getOrBootstrapCredentials(deviceName: deviceName);

  Future<InstallationCredentials> bootstrapInstallation({bool forceNew = false}) async {
    if (forceNew) {
      await _storage.clearCredentials();
      _cachedCredentials = null;
    }
    return getOrBootstrapCredentials();
  }

  Future<InstallationCredentials> getOrBootstrapCredentials({String? deviceName}) async {
    if (_cachedCredentials != null && _cachedCredentials!.isValid) {
      return _cachedCredentials!;
    }

    final stored = await _storage.getCredentials();
    if (stored != null && stored.isValid) {
      _cachedCredentials = stored;
      return stored;
    }

    final effectiveDeviceName = deviceName ??
        (Platform.isAndroid
            ? 'Android Device'
            : Platform.isIOS
                ? 'iOS Device'
                : 'Mobile Client');

    final response = await _apiClient.post(
      ApiConfig.installationBootstrapUrl,
      body: {'device_name': effectiveDeviceName},
      requireAuth: false,
    );

    if (response is Map<String, dynamic>) {
      final creds = InstallationCredentials.fromJson(response);
      if (creds.isValid) {
        await _storage.saveCredentials(creds);
        _cachedCredentials = creds;
        return creds;
      }
    }

    throw ApiException('Failed to bootstrap installation workspace.');
  }

  Future<InstallationCredentials?> getCachedOrStoredCredentials() async {
    if (_cachedCredentials != null) return _cachedCredentials;
    _cachedCredentials = await _storage.getCredentials();
    return _cachedCredentials;
  }

  Future<void> resetWorkspace() async {
    _cachedCredentials = null;
    await _storage.clearCredentials();
  }
}
