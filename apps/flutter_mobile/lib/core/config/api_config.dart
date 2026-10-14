/// Centralized API configuration for StockFlow Flutter Mobile.
/// Connects to the existing Django REST API: https://stockflow-api-lv0v.onrender.com/api
class ApiConfig {
  ApiConfig._();

  static const String defaultBaseUrl = 'https://stockflow-api-lv0v.onrender.com/api';

  static String baseUrl = defaultBaseUrl;

  static String get installationBootstrapUrl => '$baseUrl/installations/bootstrap/';
  static String get installationInfoUrl => '$baseUrl/installations/info/';
  static String get productsUrl => '$baseUrl/products/';
  static String get tasksUrl => '$baseUrl/tasks/';
  static String get dailyProgressUrl => '$baseUrl/daily-progress/';
  static String get notificationsRegisterUrl => '$baseUrl/notifications/register/';
  static String get recoverySetupUrl => '$baseUrl/recovery/setup/';
  static String get recoveryStatusUrl => '$baseUrl/recovery/status/';
  static String get recoveryRestoreUrl => '$baseUrl/recovery/restore/';

  static String productDetailUrl(int id) => '$baseUrl/products/$id/';
  static String taskDetailUrl(int id) => '$baseUrl/tasks/$id/';
  static String dailyProgressDetailUrl(int id) => '$baseUrl/daily-progress/$id/';
  static String dailyProgressByDateUrl(String date) => '$baseUrl/daily-progress/date/$date/';

  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration requestTimeout = Duration(seconds: 30);
}
