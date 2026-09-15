import 'dart:convert';

import 'package:block_survival/api/api_client.dart';
import 'package:block_survival/api/auth_api.dart';
import 'package:block_survival/api/game_api.dart';
import 'package:block_survival/api/token_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// records every request and answers from a script keyed by "METHOD path"
final class FakeServer {
  final List<http.Request> requests = [];
  final Map<String, http.Response Function(http.Request)> routes = {};

  http.Client client() => MockClient((req) async {
    requests.add(req);
    final handler = routes['${req.method} ${req.url.path}'];
    if (handler == null) {
      return http.Response('{"message":"not found"}', 404, headers: _json);
    }
    return handler(req);
  });

  static const _json = {'content-type': 'application/json'};

  static http.Response json(Object body, [int status = 200]) =>
      http.Response(jsonEncode(body), status, headers: _json);
}

void main() {
  late FakeServer server;
  late MemoryTokenStore store;
  late ApiClient client;
  late AuthApi auth;

  setUp(() {
    server = FakeServer();
    store = MemoryTokenStore(deviceToken: 'd' * 64);
    client = ApiClient(
      baseUrl: Uri.parse('https://game.test'),
      token: store.readAccessToken,
      client: server.client(),
    );
    auth = AuthApi(client, store, deviceName: 'Test PC');
  });

  test('sign-in sends credentials + device and keeps the token', () async {
    server.routes['POST /api/auth/token'] = (_) => FakeServer.json({
      'token': '1|abc',
      'user': {
        'id': 7,
        'name': 'Teddy',
        'email': 't@example.com',
        'is_admin': false,
      },
    }, 201);

    final result = await auth.signIn(email: 't@example.com', password: 'pw');

    expect(result, isA<SignedIn>().having((r) => r.user.name, 'name', 'Teddy'));
    expect(await store.readAccessToken(), '1|abc');
    final sent = jsonDecode(server.requests.single.body) as Map;
    expect(sent['device'], {'token': 'd' * 64, 'name': 'Test PC'});
    expect(server.requests.single.headers['Authorization'], isNull);
  });

  test(
    'a device waiting for approval is reported, not treated as an error',
    () async {
      server.routes['POST /api/auth/token'] = (_) => FakeServer.json({
        'message': 'This device is waiting for admin approval.',
        'pending': true,
        'device': {'id': 3, 'approved': false},
      }, 403);
      server.routes['GET /api/auth/status'] = (req) => FakeServer.json({
        'known': true,
        'approved': req.url.queryParameters['device'] == 'd' * 64,
      });

      expect(
        await auth.signIn(email: 't@example.com', password: 'pw'),
        isA<AwaitingApproval>(),
      );
      expect(await store.readAccessToken(), isNull);
      expect(await auth.deviceApproved(), isTrue);
    },
  );

  test('bad credentials and closed windows are refusals', () async {
    server.routes['POST /api/auth/token'] = (_) => FakeServer.json({
      'message': 'Wrong email or password.',
      'errors': {
        'email': ['Wrong email or password.'],
      },
    }, 422);
    expect(
      await auth.signIn(email: 'x', password: 'y'),
      isA<SignInRefused>().having(
        (r) => r.message,
        'message',
        'Wrong email or password.',
      ),
    );

    server.routes['POST /api/auth/token'] = (_) =>
        FakeServer.json({'message': 'This account has been disabled.'}, 403);
    expect(
      await auth.signIn(email: 'x', password: 'y'),
      isA<SignInRefused>().having(
        (r) => r.message,
        'message',
        'This account has been disabled.',
      ),
    );
  });

  test('an unreachable server is an ApiError with status 0', () async {
    final dead = ApiClient(
      baseUrl: Uri.parse('https://game.test'),
      token: store.readAccessToken,
      client: MockClient((_) => throw http.ClientException('down')),
    );
    expect(
      AuthApi(dead, store, deviceName: 'x').signIn(email: 'a', password: 'b'),
      throwsA(isA<ApiError>().having((e) => e.status, 'status', 0)),
    );
  });

  test(
    'the token rides every later call as a bearer header and a 401 drops it',
    () async {
      await store.writeAccessToken('1|abc');
      server.routes['GET /api/leaderboard'] = (req) =>
          req.headers['Authorization'] == 'Bearer 1|abc'
          ? FakeServer.json({
              'leaderboard': [
                {'name': 'Teddy', 'score': 42},
              ],
            })
          : FakeServer.json({'message': 'Unauthenticated.'}, 401);

      final rows = await GameApi(client).leaderboard();
      expect(rows.single.score, 42);

      await store.writeAccessToken('stale');
      server.routes['GET /api/auth/me'] = (_) =>
          FakeServer.json({'message': 'Unauthenticated.'}, 401);
      expect(await auth.me(), isNull);
      expect(
        await store.readAccessToken(),
        isNull,
        reason: 'a rejected token is forgotten',
      );
    },
  );

  test(
    'sign-out revokes on the server and forgets locally even when the server is down',
    () async {
      await store.writeAccessToken('1|abc');
      server.routes['POST /api/auth/logout'] = (_) => http.Response('', 204);
      await auth.signOut();
      expect(server.requests.single.headers['Authorization'], 'Bearer 1|abc');
      expect(await store.readAccessToken(), isNull);

      await store.writeAccessToken('2|def');
      server.routes['POST /api/auth/logout'] = (_) => http.Response('', 500);
      await auth.signOut();
      expect(await store.readAccessToken(), isNull);
    },
  );

  test('device tokens look like the server expects', () {
    final token = newDeviceToken();
    expect(token, matches(RegExp(r'^[A-Za-z0-9]{64}$')));
    expect(newDeviceToken(), isNot(token));
  });
}
