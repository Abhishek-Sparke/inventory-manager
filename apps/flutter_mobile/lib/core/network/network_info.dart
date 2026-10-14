import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';

class NetworkInfo {
  final Connectivity _connectivity;
  final _controller = StreamController<bool>.broadcast();

  NetworkInfo({Connectivity? connectivity})
      : _connectivity = connectivity ?? Connectivity() {
    _connectivity.onConnectivityChanged.listen((results) {
      final isConnected = _hasConnection(results);
      _controller.add(isConnected);
    });
  }

  Stream<bool> get onConnectivityChanged => _controller.stream;

  Future<bool> get isConnected async {
    final results = await _connectivity.checkConnectivity();
    return _hasConnection(results);
  }

  bool _hasConnection(dynamic results) {
    if (results is List<ConnectivityResult>) {
      if (results.isEmpty) return false;
      return results.any((r) =>
          r == ConnectivityResult.mobile ||
          r == ConnectivityResult.wifi ||
          r == ConnectivityResult.ethernet);
    } else if (results is ConnectivityResult) {
      return results == ConnectivityResult.mobile ||
          results == ConnectivityResult.wifi ||
          results == ConnectivityResult.ethernet;
    }
    return false;
  }

  void dispose() {
    _controller.close();
  }
}
