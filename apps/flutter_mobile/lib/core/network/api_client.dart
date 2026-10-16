import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import '../config/api_config.dart';
import '../storage/secure_storage.dart';

class ApiException implements Exception {
  final String message;
  final int? statusCode;
  final dynamic responseBody;

  ApiException(this.message, {this.statusCode, this.responseBody});

  @override
  String toString() => 'ApiException: $message (status: $statusCode)';
}

class ApiClient {
  final http.Client _client;
  final SecureStorageService _storage;

  ApiClient({http.Client? client, SecureStorageService? storage})
      : _client = client ?? http.Client(),
        _storage = storage ?? SecureStorageService();

  Future<Map<String, String>> _getHeaders({bool requireAuth = true}) async {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (requireAuth) {
      final creds = await _storage.getCredentials();
      if (creds != null && creds.isValid) {
        headers['X-Installation-Id'] = creds.installationId;
        headers['X-Installation-Token'] = creds.installationToken;
      }
    }

    return headers;
  }

  Future<dynamic> get(String url, {bool requireAuth = true}) async {
    try {
      final headers = await _getHeaders(requireAuth: requireAuth);
      final response = await _client
          .get(Uri.parse(url), headers: headers)
          .timeout(ApiConfig.requestTimeout);
      return _processResponse(response);
    } on SocketException {
      throw ApiException('No internet connection. Operating offline.');
    } on TimeoutException {
      throw ApiException('Request timed out. Please check your connection.');
    } catch (e) {
      if (e is ApiException) rethrow;
      throw ApiException('Network error: $e');
    }
  }

  Future<dynamic> post(String url, {dynamic body, bool requireAuth = true}) async {
    try {
      final headers = await _getHeaders(requireAuth: requireAuth);
      final response = await _client
          .post(
            Uri.parse(url),
            headers: headers,
            body: body != null ? jsonEncode(body) : null,
          )
          .timeout(ApiConfig.requestTimeout);
      return _processResponse(response);
    } on SocketException {
      throw ApiException('No internet connection. Operating offline.');
    } on TimeoutException {
      throw ApiException('Request timed out. Please check your connection.');
    } catch (e) {
      if (e is ApiException) rethrow;
      throw ApiException('Network error: $e');
    }
  }

  Future<dynamic> put(String url, {dynamic body, bool requireAuth = true}) async {
    try {
      final headers = await _getHeaders(requireAuth: requireAuth);
      final response = await _client
          .put(
            Uri.parse(url),
            headers: headers,
            body: body != null ? jsonEncode(body) : null,
          )
          .timeout(ApiConfig.requestTimeout);
      return _processResponse(response);
    } on SocketException {
      throw ApiException('No internet connection. Operating offline.');
    } on TimeoutException {
      throw ApiException('Request timed out. Please check your connection.');
    } catch (e) {
      if (e is ApiException) rethrow;
      throw ApiException('Network error: $e');
    }
  }

  Future<dynamic> patch(String url, {dynamic body, bool requireAuth = true}) async {
    try {
      final headers = await _getHeaders(requireAuth: requireAuth);
      final response = await _client
          .patch(
            Uri.parse(url),
            headers: headers,
            body: body != null ? jsonEncode(body) : null,
          )
          .timeout(ApiConfig.requestTimeout);
      return _processResponse(response);
    } on SocketException {
      throw ApiException('No internet connection. Operating offline.');
    } on TimeoutException {
      throw ApiException('Request timed out. Please check your connection.');
    } catch (e) {
      if (e is ApiException) rethrow;
      throw ApiException('Network error: $e');
    }
  }

  Future<dynamic> delete(String url, {bool requireAuth = true}) async {
    try {
      final headers = await _getHeaders(requireAuth: requireAuth);
      final response = await _client
          .delete(Uri.parse(url), headers: headers)
          .timeout(ApiConfig.requestTimeout);
      return _processResponse(response);
    } on SocketException {
      throw ApiException('No internet connection. Operating offline.');
    } on TimeoutException {
      throw ApiException('Request timed out. Please check your connection.');
    } catch (e) {
      if (e is ApiException) rethrow;
      throw ApiException('Network error: $e');
    }
  }

  dynamic _processResponse(http.Response response) {
    final statusCode = response.statusCode;
    final bodyString = utf8.decode(response.bodyBytes);

    dynamic decoded;
    if (bodyString.isNotEmpty) {
      try {
        decoded = jsonDecode(bodyString);
      } catch (_) {
        decoded = bodyString;
      }
    }

    if (statusCode >= 200 && statusCode < 300) {
      return decoded;
    }

    if (statusCode == 401 || statusCode == 403) {
      throw ApiException(
        'Authentication failed. Invalid installation workspace credentials.',
        statusCode: statusCode,
        responseBody: decoded,
      );
    }

    String errorMsg = 'Server responded with status $statusCode';
    if (decoded is Map<String, dynamic>) {
      if (decoded.containsKey('detail')) {
        errorMsg = decoded['detail'].toString();
      } else if (decoded.containsKey('error')) {
        errorMsg = decoded['error'].toString();
      } else if (decoded.isNotEmpty) {
        final firstKey = decoded.keys.first;
        final firstVal = decoded[firstKey];
        if (firstVal is List && firstVal.isNotEmpty) {
          errorMsg = '$firstKey: ${firstVal.first}';
        } else {
          errorMsg = '$firstKey: $firstVal';
        }
      }
    }

    throw ApiException(
      errorMsg,
      statusCode: statusCode,
      responseBody: decoded,
    );
  }
}
