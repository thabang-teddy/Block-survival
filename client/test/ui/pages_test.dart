/// The pages, driven through a scripted server: sign-in → pending approval,
/// sign-in → lobby with worlds / invitations / leaderboard, and the HUD's
/// readouts, pause overlay and crafting panel over a real (unrendered) game.
library;

import 'dart:convert';

import 'package:block_survival/api/api_client.dart';
import 'package:block_survival/api/token_store.dart';
import 'package:block_survival/app/launch.dart';
import 'package:block_survival/app/session.dart';
import 'package:block_survival/game/game.dart';
import 'package:block_survival/game/ui_state.dart';
import 'package:block_survival/net/host_session.dart';
import 'package:block_survival/ui/hud/hud.dart';
import 'package:block_survival/ui/pages/lobby_page.dart';
import 'package:block_survival/ui/pages/login_page.dart';
import 'package:block_survival/ui/pages/pending_approval_page.dart';
import 'package:block_survival/ui/theme.dart';
import 'package:block_survival/world/seed.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../net/fakes.dart';

const _json = {'content-type': 'application/json'};
http.Response _ok(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status, headers: _json);

final _user = {
  'id': 7,
  'name': 'Teddy',
  'email': 't@example.com',
  'is_admin': false,
};

AppSession _session(Map<String, http.Response Function(http.Request)> routes) {
  final store = MemoryTokenStore(deviceToken: 'd' * 64);
  final client = ApiClient(
    baseUrl: Uri.parse('https://game.test'),
    token: store.readAccessToken,
    client: MockClient((req) async {
      final h = routes['${req.method} ${req.url.path}'];
      return h == null ? _ok({'message': 'not found'}, 404) : h(req);
    }),
  );
  return AppSession(
    serverUrl: Uri.parse('https://game.test'),
    deviceName: 'test',
    store: store,
    client: client,
  );
}

Map<String, http.Response Function(http.Request)> _lobbyRoutes({
  bool ownWorld = true,
}) => {
  'GET /api/auth/me': (_) => _ok({
    'user': _user,
    'worlds': {
      'own': ownWorld
          ? {
              'kind': 'own',
              'size': 1234,
              'night': 3,
              'seconds': 400,
              'players': 2,
              'updated_at': DateTime.now().toIso8601String(),
            }
          : null,
      'global': null,
    },
  }),
  'GET /api/leaderboard': (_) => _ok({
    'leaderboard': [
      {'name': 'Teddy', 'score': 315},
      {'name': 'Kiddo', 'score': 100},
    ],
  }),
  'GET /api/global/presence': (_) => _ok({'online': 2, 'host_name': 'Sam'}),
  'GET /api/invites': (_) => _ok({
    'invites': [
      {
        'id': 4,
        'code': 'ABCDEF',
        'host_name': 'Sam',
        'world_kind': 'own',
        'players': 1,
        'max_players': 4,
        'expires_at': DateTime.now()
            .add(const Duration(minutes: 5))
            .toIso8601String(),
        'status': 'pending',
      },
    ],
  }),
};

Widget _wrap(Widget child) => MaterialApp(theme: buildTheme(), home: child);

void main() {
  testWidgets('sign-in with wrong credentials shows the error inline', (
    tester,
  ) async {
    final s = _session({
      'POST /api/auth/token': (_) =>
          _ok({'message': 'Wrong email or password.'}, 422),
    });
    await tester.pumpWidget(_wrap(LoginPage(session: s)));
    expect(find.text('Sign in'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 't@example.com');
    await tester.enterText(find.byType(TextField).last, 'nope');
    await tester.pump(); // the button enables once both fields have text
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('Wrong email or password.'), findsOneWidget);
    expect(s.state, isNot(AuthState.signedIn));
  });

  testWidgets('a device waiting for approval parks on the approval page', (
    tester,
  ) async {
    final s = _session({
      'POST /api/auth/token': (_) => _ok({
        'message': 'waiting',
        'pending': true,
        'device': {'id': 3, 'approved': false},
      }, 403),
    });
    await s.signIn(email: 't@example.com', password: 'pw');
    expect(s.state, AuthState.pendingApproval);
    await tester.pumpWidget(_wrap(PendingApprovalPage(session: s)));
    expect(find.textContaining('waiting for approval'), findsOneWidget);
    expect(find.text('Back to sign in'), findsOneWidget);
    s.deviceApproved = true;
    s.notifyListeners();
    await tester.pump();
    expect(find.textContaining('This device is approved'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pump();
    expect(s.state, AuthState.signedOut);
    s.dispose();
  });

  testWidgets(
    'the lobby shows the worlds, presence, invitations and leaderboard',
    (tester) async {
      final routes = _lobbyRoutes();
      routes['POST /api/auth/token'] = (_) =>
          _ok({'token': '1|abc', 'user': _user}, 201);
      final s = _session(routes);
      await s.signIn(email: 't@example.com', password: 'pw');
      expect(s.state, AuthState.signedIn);
      final launcher = Launcher(
        api: s.api,
        rtc: FakeRtc(),
        player: const LocalPlayer(name: 'Teddy', userId: 7),
      );
      await tester.pumpWidget(
        _wrap(LobbyPage(session: s, launcher: launcher, onLaunch: (_) {})),
      );
      await tester.pumpAndSettle();
      expect(find.text('Teddy'), findsWidgets);
      expect(find.text('Play solo'), findsOneWidget);
      expect(find.text('Host for friends'), findsOneWidget);
      expect(find.text('Start over with a new world'), findsOneWidget);
      expect(
        find.textContaining('Night 3 · 6:40 survived · 2 players'),
        findsOneWidget,
      );
      expect(
        find.textContaining('2 online now, hosted by Sam'),
        findsOneWidget,
      );
      expect(find.text('Enter'), findsOneWidget);
      expect(find.textContaining("Sam's world · 1/4"), findsOneWidget);
      expect(find.text('Accept'), findsOneWidget);
      expect(find.text('Leaderboard'), findsOneWidget);
      expect(find.text('315'), findsOneWidget);
      s.stopInvitesPolling();
      s.dispose();
    },
  );

  testWidgets('the HUD shows the readouts, pauses, and opens crafting', (
    tester,
  ) async {
    final game = Game(
      seed: globalSeed,
      local: const LocalPlayer(name: 'Teddy', userId: 7),
      role: Role.host,
      worldKind: WorldKind.own,
    );
    final host = HostSession(
      FakeSignalApi(FakeMailbox()),
      FakeRtc(),
      code: 'ABCDEF',
    );
    final launch = Launch(game: game, worldKind: WorldKind.own, host: host);
    game.inventory.add('log', 3);
    game.update(0.1, const FrameInput());
    var resumed = false;
    await tester.pumpWidget(
      _wrap(
        Scaffold(
          body: HudLayer(
            launch: launch,
            api: _session({}).api,
            paused: true,
            touch: false,
            actions: HudActions(
              resume: () => resumed = true,
              leave: () async {},
              saveWorld: () async => 'Saved',
              closePanel: game.closePanel,
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('BLOCK'), findsOneWidget);
    expect(find.text('15:00'), findsOneWidget);
    expect(find.text('sunset in'), findsOneWidget);
    expect(find.text('Click to play'), findsOneWidget);
    expect(
      find.text('3'),
      findsWidgets,
      reason: 'the hotbar shows the log stack',
    );
    expect(
      find.textContaining('Player'),
      findsOneWidget,
      reason: 'scoreboard header while paused',
    );
    await tester.tap(find.text('Click to play'));
    expect(resumed, isTrue);

    game.togglePanel();
    game.update(0.05, const FrameInput());
    await tester.pump();
    expect(find.text('Crafting'), findsOneWidget);
    expect(find.text('no workbench nearby'), findsOneWidget);
    expect(find.text('Craft'), findsOneWidget);
    await tester.tap(find.text('Craft'));
    await tester.pump();
    expect(game.inventory.count('planks'), 4);
    expect(game.inventory.count('log'), 2);
    game.dispose();
  });
}
