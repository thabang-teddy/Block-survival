/// HTTP transport for the Laravel JSON API — twin of the `request` helper in
/// `server/resources/js/net/api.ts`. The browser client rides its session cookie;
/// this one sends the Sanctum bearer token issued by `POST /api/auth/token`.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

/// a failed call; status 0 means the server could not be reached at all
final class ApiError implements Exception {
  const ApiError(this.status, this.message, {this.pending = false});

  final int status;
  final String message;

  /// sign-in refused only because the device is still waiting for admin approval
  final bool pending;

  bool get unauthenticated => status == 401;

  @override
  String toString() => 'ApiError($status): $message';
}

/// the parsed body of a successful call: JSON when the server sent JSON, else raw bytes
final class ApiResponse {
  const ApiResponse({required this.status, this.json, required this.bytes});

  final int status;
  final Map<String, dynamic>? json;
  final Uint8List bytes;
}

typedef TokenProvider = Future<String?> Function();

final class ApiClient {
  ApiClient({
    required Uri baseUrl,
    required this._token,
    http.Client? client,
    this.timeout = const Duration(seconds: 20),
  }) : _base = baseUrl,
       _http = client ?? http.Client();

  final Uri _base;
  final TokenProvider _token;
  final http.Client _http;
  final Duration timeout;

  /// called with 401 responses so the app can drop a token the server no longer honours
  void Function()? onUnauthenticated;

  Uri url(String path, [Map<String, String>? query]) => _base.replace(
    path: '${_base.path.replaceAll(RegExp(r'/$'), '')}/api$path',
    queryParameters: query,
  );

  Future<ApiResponse> get(String path, {Map<String, String>? query}) =>
      send('GET', path, query: query);

  Future<ApiResponse> post(String path, [Object? body]) =>
      send('POST', path, body: body);

  Future<ApiResponse> patch(String path, [Object? body]) =>
      send('PATCH', path, body: body);

  Future<ApiResponse> put(
    String path, {
    Object? body,
    Uint8List? raw,
    String? contentType,
    Map<String, String>? query,
  }) => send(
    'PUT',
    path,
    body: body,
    raw: raw,
    contentType: contentType,
    query: query,
  );

  Future<ApiResponse> delete(String path, [Object? body]) =>
      send('DELETE', path, body: body);

  Future<ApiResponse> send(
    String method,
    String path, {
    Object? body,
    Uint8List? raw,
    String? contentType,
    Map<String, String>? query,
  }) async {
    final request = http.Request(method, url(path, query));
    request.headers['Accept'] = 'application/json';
    request.headers['X-Requested-With'] = 'XMLHttpRequest';
    final token = await _token();
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    } else if (raw != null) {
      request.headers['Content-Type'] =
          contentType ?? 'application/octet-stream';
      request.bodyBytes = raw;
    }

    final http.Response response;
    try {
      response = await http.Response.fromStream(
        await _http.send(request).timeout(timeout),
      );
    } on Exception {
      throw const ApiError(0, 'Could not reach the server');
    }

    final isJson =
        response.headers['content-type']?.contains('application/json') ?? false;
    Map<String, dynamic>? json;
    if (isJson && response.bodyBytes.isNotEmpty) {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      json = decoded is Map<String, dynamic> ? decoded : null;
    }
    if (response.statusCode == 401) onUnauthenticated?.call();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiError(
        response.statusCode,
        _errorMessage(json, response.statusCode),
        pending: json?['pending'] == true,
      );
    }
    return ApiResponse(
      status: response.statusCode,
      json: json,
      bytes: response.bodyBytes,
    );
  }

  static String _errorMessage(Map<String, dynamic>? json, int status) {
    final message = json?['message'];
    if (message is String && message.isNotEmpty) return message;
    final errors = json?['errors'];
    if (errors is Map && errors.isNotEmpty) {
      final first = errors.values.first;
      if (first is List && first.isNotEmpty) return first.first.toString();
    }
    return 'HTTP $status';
  }

  void close() => _http.close();
}
