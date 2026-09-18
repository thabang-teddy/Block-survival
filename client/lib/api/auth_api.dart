/// Token sign-in against `POST /api/auth/token` (docs/flutter-client-plan.md D2/S5).
library;

import 'dart:async';

import 'package:block_survival/api/api_client.dart';
import 'package:block_survival/api/models.dart';
import 'package:block_survival/api/token_store.dart';

/// what `GET /api/auth/me` returns: the account and its two world summaries
typedef Me = ({ApiUser user, Map<String, WorldMeta?> worlds});

/// what sign-in produced
sealed class SignInResult {
  const SignInResult();
}

final class SignedIn extends SignInResult {
  const SignedIn(this.user);

  final ApiUser user;
}

/// the device row exists; an admin has to approve it before a token is issued
final class AwaitingApproval extends SignInResult {
  const AwaitingApproval(this.message);

  final String message;
}

/// refused: bad credentials, disabled account, closed login window
final class SignInRefused extends SignInResult {
  const SignInRefused(this.message);

  final String message;
}

final class AuthApi {
  AuthApi(this._client, this._store, {required this.deviceName}) {
    // any 401 means the server no longer honours the token: forget it centrally
    _client.onUnauthenticated = () => unawaited(_store.writeAccessToken(null));
  }

  final ApiClient _client;
  final TokenStore _store;

  /// shown on the admin's device page ("Teddy's laptop")
  final String deviceName;

  Future<SignInResult> signIn({
    required String email,
    required String password,
  }) async {
    try {
      final res = await _client.post('/auth/token', {
        'email': email,
        'password': password,
        'device': {'token': await _store.deviceToken(), 'name': deviceName},
      });
      final json = res.json ?? const {};
      await _store.writeAccessToken(json['token'] as String);
      return SignedIn(ApiUser.fromJson(json['user'] as Map<String, dynamic>));
    } on ApiError catch (e) {
      if (e.pending) return AwaitingApproval(e.message);
      if (e.status == 401 || e.status == 403 || e.status == 422) {
        return SignInRefused(e.message);
      }
      rethrow;
    }
  }

  /// poll while parked on approval; true once an admin has approved this device
  Future<bool> deviceApproved() async {
    // POST: the device token must never travel in a query string
    final res = await _client.post('/auth/status', {
      'device': await _store.deviceToken(),
    });
    return res.json?['approved'] == true;
  }

  /// who the stored token belongs to, or null when there is no usable token
  Future<ApiUser?> me() async => (await meWithWorlds())?.user;

  /// the account plus the lobby's world summaries (own / global)
  Future<Me?> meWithWorlds() async {
    if (await _store.readAccessToken() == null) return null;
    try {
      final json = (await _client.get('/auth/me')).json!;
      final worlds = (json['worlds'] as Map<String, dynamic>? ?? const {});
      return (
        user: ApiUser.fromJson(json['user'] as Map<String, dynamic>),
        worlds: {
          for (final k in const ['own', 'global'])
            k: worlds[k] == null
                ? null
                : WorldMeta.fromJson(worlds[k] as Map<String, dynamic>),
        },
      );
    } on ApiError catch (e) {
      if (e.unauthenticated || e.status == 403) {
        await _store.writeAccessToken(null);
        return null;
      }
      rethrow;
    }
  }

  /// revoke the token on the server and forget it locally (locally even if the server is unreachable)
  Future<void> signOut() async {
    try {
      await _client.post('/auth/logout');
    } on ApiError {
      // the token is dropped either way; a dead token on the server is harmless
    } finally {
      await _store.writeAccessToken(null);
    }
  }
}
