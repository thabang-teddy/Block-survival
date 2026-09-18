/// Where the native client keeps its two secrets: the Sanctum bearer token and the
/// device token that identifies this installation to the admin's device page.
library;

import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

abstract interface class TokenStore {
  Future<String?> readAccessToken();
  Future<void> writeAccessToken(String? token);

  /// the 64-char device token, generated on first use and kept for the life of the install
  Future<String> deviceToken();
}

const _alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/// same shape as `Device::newToken()` on the server: 64 alphanumerics
String newDeviceToken([Random? random]) {
  final rng = random ?? Random.secure();
  return List.generate(
    64,
    (_) => _alphabet[rng.nextInt(_alphabet.length)],
  ).join();
}

/// Keychain / EncryptedSharedPreferences / libsecret via flutter_secure_storage
final class SecureTokenStore implements TokenStore {
  SecureTokenStore([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  static const _accessKey = 'bs.access_token';
  static const _deviceKey = 'bs.device_token';

  final FlutterSecureStorage _storage;

  @override
  Future<String?> readAccessToken() => _storage.read(key: _accessKey);

  @override
  Future<void> writeAccessToken(String? token) => token == null
      ? _storage.delete(key: _accessKey)
      : _storage.write(key: _accessKey, value: token);

  @override
  Future<String> deviceToken() async {
    final existing = await _storage.read(key: _deviceKey);
    if (existing != null) return existing;
    final token = newDeviceToken();
    await _storage.write(key: _deviceKey, value: token);
    return token;
  }
}

/// for tests and throwaway sessions
final class MemoryTokenStore implements TokenStore {
  MemoryTokenStore({String? accessToken, String? deviceToken})
    : _access = accessToken,
      _device = deviceToken ?? newDeviceToken();

  String? _access;
  final String _device;

  @override
  Future<String?> readAccessToken() async => _access;

  @override
  Future<void> writeAccessToken(String? token) async => _access = token;

  @override
  Future<String> deviceToken() async => _device;
}
