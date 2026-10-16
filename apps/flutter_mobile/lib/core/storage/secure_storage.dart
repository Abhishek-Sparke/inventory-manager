import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../features/auth/models/installation.dart';

class SecureStorageService {
  static const String _keyInstallationId = 'stockflow_installation_id_v1';
  static const String _keyInstallationToken = 'stockflow_installation_token_v1';
  static const String _keyDeviceName = 'stockflow_device_name_v1';

  final FlutterSecureStorage _secureStorage;

  SecureStorageService({FlutterSecureStorage? secureStorage})
      : _secureStorage = secureStorage ?? const FlutterSecureStorage();

  Future<void> saveCredentials(InstallationCredentials creds) async {
    try {
      await _secureStorage.write(
        key: _keyInstallationId,
        value: creds.installationId,
      );
      await _secureStorage.write(
        key: _keyInstallationToken,
        value: creds.installationToken,
      );
      if (creds.deviceName.isNotEmpty) {
        await _secureStorage.write(
          key: _keyDeviceName,
          value: creds.deviceName,
        );
      }
    } catch (_) {
      // Fallback for emulators without secure hardware keystore
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_keyInstallationId, creds.installationId);
      await prefs.setString(_keyInstallationToken, creds.installationToken);
      if (creds.deviceName.isNotEmpty) {
        await prefs.setString(_keyDeviceName, creds.deviceName);
      }
    }
  }

  Future<InstallationCredentials?> getCredentials() async {
    try {
      final id = await _secureStorage.read(key: _keyInstallationId);
      final token = await _secureStorage.read(key: _keyInstallationToken);
      final device = await _secureStorage.read(key: _keyDeviceName) ?? '';

      if (id != null && token != null && id.isNotEmpty && token.isNotEmpty) {
        return InstallationCredentials(
          installationId: id,
          installationToken: token,
          deviceName: device,
        );
      }
    } catch (_) {
      // Fallback read
    }

    final prefs = await SharedPreferences.getInstance();
    final id = prefs.getString(_keyInstallationId);
    final token = prefs.getString(_keyInstallationToken);
    final device = prefs.getString(_keyDeviceName) ?? '';

    if (id != null && token != null && id.isNotEmpty && token.isNotEmpty) {
      return InstallationCredentials(
        installationId: id,
        installationToken: token,
        deviceName: device,
      );
    }

    return null;
  }

  Future<void> clearCredentials() async {
    try {
      await _secureStorage.delete(key: _keyInstallationId);
      await _secureStorage.delete(key: _keyInstallationToken);
      await _secureStorage.delete(key: _keyDeviceName);
    } catch (_) {}

    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_keyInstallationId);
    await prefs.remove(_keyInstallationToken);
    await prefs.remove(_keyDeviceName);
  }
}

class SecureStorage {
  SecureStorage._();

  static final SecureStorageService _instance = SecureStorageService();

  static Future<void> saveCredentials(InstallationCredentials creds) =>
      _instance.saveCredentials(creds);

  static Future<InstallationCredentials?> getInstallationCredentials() =>
      _instance.getCredentials();

  static Future<void> clearCredentials() => _instance.clearCredentials();
}
