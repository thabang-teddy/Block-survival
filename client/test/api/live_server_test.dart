/// S5 acceptance: the native client signs in against a real Laravel server and
/// reads the leaderboard with its token. Skipped unless the environment names a
/// server, e.g. (after `php artisan serve` in server/ with a test account):
///
///   BS_SERVER_URL=http://127.0.0.1:8000 BS_EMAIL=... BS_PASSWORD=... flutter test test/api/live_server_test.dart
///
/// The device token is random per run, so the first run parks on approval unless
/// the account is an admin (admins skip device approval).
library;

import 'dart:io';

import 'package:block_survival/api/api_client.dart';
import 'package:block_survival/api/auth_api.dart';
import 'package:block_survival/api/game_api.dart';
import 'package:block_survival/api/token_store.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final url = Platform.environment['BS_SERVER_URL'];
  final email = Platform.environment['BS_EMAIL'];
  final password = Platform.environment['BS_PASSWORD'];

  test(
    'token sign-in, /api/auth/me, /api/leaderboard and sign-out against a live server',
    () async {
      final store = MemoryTokenStore();
      final client = ApiClient(
        baseUrl: Uri.parse(url!),
        token: store.readAccessToken,
      );
      final auth = AuthApi(client, store, deviceName: 'live_server_test');

      final result = await auth.signIn(email: email!, password: password!);
      expect(
        result,
        isA<SignedIn>(),
        reason: 'sign-in should succeed for an approved device or admin',
      );

      final me = await auth.me();
      expect(me?.email, email);

      final rows = await GameApi(client).leaderboard();
      expect(rows, isA<List>());

      await auth.signOut();
      expect(await auth.me(), isNull);
      client.close();
    },
    skip: url == null || email == null || password == null
        ? 'set BS_SERVER_URL, BS_EMAIL and BS_PASSWORD to run against a live server'
        : false,
  );
}
