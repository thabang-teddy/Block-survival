/// Non-secret preferences the app keeps between launches — for now only the
/// server the client talks to (typed on the sign-in page).
library;

import 'package:shared_preferences/shared_preferences.dart';

abstract interface class SettingsStore {
  Future<String?> readServerUrl();
  Future<void> writeServerUrl(String? url);
}

final class PrefsSettingsStore implements SettingsStore {
  static const _serverKey = 'bs.server_url';

  @override
  Future<String?> readServerUrl() async =>
      (await SharedPreferences.getInstance()).getString(_serverKey);

  @override
  Future<void> writeServerUrl(String? url) async {
    final prefs = await SharedPreferences.getInstance();
    if (url == null) {
      await prefs.remove(_serverKey);
    } else {
      await prefs.setString(_serverKey, url);
    }
  }
}

/// for tests and throwaway sessions
final class MemorySettingsStore implements SettingsStore {
  MemorySettingsStore({String? serverUrl}) : _url = serverUrl;

  String? _url;

  @override
  Future<String?> readServerUrl() async => _url;

  @override
  Future<void> writeServerUrl(String? url) async => _url = url;
}

/// a DNS name, an IPv4 address, or a bracketed IPv6 address
final RegExp _hostPattern = RegExp(
  r'^([A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*|\[?[0-9A-Fa-f:.]+\]?)$',
);

/// The server address a player typed, normalised to an http(s) origin, or
/// null when it cannot be one. "block-survival.test" becomes
/// "http://block-survival.test"; a trailing slash is dropped.
Uri? parseServerUrl(String text) {
  var t = text.trim();
  if (t.isEmpty) return null;
  if (!t.contains('://')) t = 'http://$t';
  final uri = Uri.tryParse(t);
  if (uri == null || !_hostPattern.hasMatch(uri.host)) return null;
  if (uri.scheme != 'http' && uri.scheme != 'https') return null;
  return uri.replace(
    path: uri.path.replaceAll(RegExp(r'/+$'), ''),
    query: null,
    fragment: null,
  );
}
