import 'package:flutter_test/flutter_test.dart';
import 'package:stockflow_mobile/core/config/api_config.dart';

void main() {
  group('ApiConfig Tests', () {
    test('Base URL is pointed to live Django REST API', () {
      expect(ApiConfig.baseUrl, 'https://stockflow-api-lv0v.onrender.com/api');
    });

    test('Endpoint URIs match backend routes', () {
      expect(ApiConfig.productsUrl, 'https://stockflow-api-lv0v.onrender.com/api/products/');
      expect(ApiConfig.productDetailUrl(5), 'https://stockflow-api-lv0v.onrender.com/api/products/5/');
      expect(ApiConfig.tasksUrl, 'https://stockflow-api-lv0v.onrender.com/api/tasks/');
      expect(ApiConfig.taskDetailUrl(12), 'https://stockflow-api-lv0v.onrender.com/api/tasks/12/');
      expect(ApiConfig.dailyProgressUrl, 'https://stockflow-api-lv0v.onrender.com/api/daily-progress/');
      expect(ApiConfig.dailyProgressByDateUrl('2026-10-14'), 'https://stockflow-api-lv0v.onrender.com/api/daily-progress/date/2026-10-14/');
      expect(ApiConfig.installationBootstrapUrl, 'https://stockflow-api-lv0v.onrender.com/api/installations/bootstrap/');
    });
  });
}
