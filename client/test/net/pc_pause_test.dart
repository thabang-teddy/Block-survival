// The host PC (docs/pc-host-research.md §5.4, §8): a global world's answers,
// a PC-hosted session pausing on silence or a dropped link, and the launcher
// waiting for the PC — however long — then joining it again, or reporting the
// world closed.
import 'package:block_survival/api/api_client.dart';
import 'package:block_survival/api/models.dart';
import 'package:block_survival/app/launch.dart';
import 'package:block_survival/game/game.dart';
import 'package:block_survival/game/rules.dart';
import 'package:block_survival/game/ui_state.dart';
import 'package:block_survival/net/client_session.dart';
import 'package:block_survival/net/host_session.dart';
import 'package:block_survival/world/seed.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fakes.dart';

Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 20));

Map<String, dynamic> roomJson(String code) => {
  'code': code,
  'host_peer_id': 'hostAAAAAAAA',
  'host_name': 'HomePC',
  'world_kind': 'global',
  'players': 1,
  'expires_at': '',
};

const int world = 3;

GlobalState pc(String code) => GlobalState.fromJson({
  'status': 'client',
  'host': 'pc',
  'world': world,
  'host_name': 'HomePC',
  'room': roomJson(code),
  'online': 1,
});

final GlobalState paused = GlobalState.fromJson({
  'status': 'paused',
  'host': 'pc',
  'world': world,
  'host_name': 'HomePC',
  'online': 1,
});

final GlobalState offline = GlobalState.fromJson({
  'status': 'offline',
  'host': 'pc',
  'message': "This world is offline — its host PC isn't running.",
});

/// the global world's answers in order (the last one repeats), over the fake mailbox
final class FakeGlobalApi extends FakeSignalApi {
  FakeGlobalApi(super.mailbox, this.answers);

  final List<Object> answers;
  int claims = 0;
  final List<int> joins = [];

  Future<GlobalState> _next() async {
    final a = answers.length > 1 ? answers.removeAt(0) : answers.first;
    if (a is ApiError) throw a;
    return a as GlobalState;
  }

  @override
  Future<GlobalState> claimGlobal() {
    claims++;
    return _next();
  }

  @override
  Future<GlobalState> joinGlobal(int world) {
    joins.add(world);
    return _next();
  }

  @override
  Future<GameRules> rules() async => GameRules.defaults;
}

/// a HostSession stands in for the PC: it speaks the same protocol
Future<HostSession> fakePc(FakeSignalApi api, FakeRtc rtc, String code) async {
  final game = Game(
    seed: globalSeed,
    local: const LocalPlayer(name: 'HomePC', userId: 99),
    role: Role.host,
    worldKind: WorldKind.global,
  );
  final host = HostSession(api, rtc, code: code)..attach(game);
  await host.listen('HomePC', WorldKind.global);
  return host;
}

void main() {
  group('a global world answers', () {
    test('join its PC, wait for it, or go back: it closed', () {
      expect(
        pc('PCPCPC'),
        isA<GlobalClient>()
            .having((c) => c.world, 'world', world)
            .having((c) => c.room.code, 'code', 'PCPCPC'),
      );
      expect(
        paused,
        isA<GlobalPaused>().having((p) => p.hostName, 'hostName', 'HomePC'),
      );
      expect(
        offline,
        isA<GlobalOffline>().having(
          (o) => o.message,
          'message',
          contains('offline'),
        ),
      );
    });

    test('the lobby list reads every world and its state', () {
      final w = GlobalWorldInfo.fromJson({
        'id': 2,
        'name': 'Attic',
        'seed': 4242,
        'state': 'paused',
        'online': 1,
        'save': null,
      });
      expect(w.state, WorldState.paused);
      expect(w.seed, 4242);
      expect(w.save, isNull);
      expect(WorldState.parse('nonsense'), WorldState.offline);
    });
  });

  group('a PC-hosted session', () {
    test('pauses on silence, sends nothing meanwhile, and snapshots on the same link lift it', () async {
      final mailbox = FakeMailbox();
      final rtc = FakeRtc();
      final api = FakeSignalApi(mailbox);
      final host = await fakePc(api, rtc, 'PCPCPC');
      var now = Duration.zero;
      final client = ClientSession(
        api,
        rtc,
        'PCPCPC',
        'Ana',
        userId: 1,
        hostKind: HostKind.pc,
        clock: () => now,
      );
      final statuses = <ClientStatus>[];
      client.onStatus = statuses.add;
      await client.connect(timeout: const Duration(seconds: 5));
      final game = Game(
        seed: globalSeed,
        local: const LocalPlayer(name: 'Ana', userId: 1),
        role: Role.client,
        worldKind: WorldKind.global,
      );
      client.attach(game);
      await settle();

      now += pauseAfterSilence + const Duration(milliseconds: 100);
      client.tick(1);
      expect(client.paused, isTrue);

      // the PC carries on over the same link
      host.tick(0.1);
      await settle();
      expect(client.status, ClientStatus.joined);
      expect(statuses, [
        ClientStatus.joined,
        ClientStatus.paused,
        ClientStatus.joined,
      ]);
      await client.dispose();
      await host.dispose();
    });

    test('a dropped link is a pause with the PC, and the end of the match with a player host', () async {
      for (final kind in HostKind.values) {
        final mailbox = FakeMailbox();
        final rtc = FakeRtc();
        final api = FakeSignalApi(mailbox);
        final host = await fakePc(api, rtc, 'PCPCPC');
        final client = ClientSession(
          api,
          rtc,
          'PCPCPC',
          'Ana',
          userId: 1,
          hostKind: kind,
        );
        await client.connect(timeout: const Duration(seconds: 5));
        await host.dispose();
        await settle();
        expect(
          client.status,
          kind == HostKind.pc ? ClientStatus.paused : ClientStatus.hostLeft,
          reason: '$kind',
        );
        await client.dispose();
      }
    });
  });

  group('waiting for the host PC', () {
    Launcher launcher(FakeGlobalApi api, FakeRtc rtc, List<Duration> slept) =>
        Launcher(
          api: api,
          rtc: rtc,
          player: const LocalPlayer(name: 'Ana', userId: 1),
          sleep: (d) async => slept.add(d),
        );

    test(
      'polls every 5 s while the PC is paused, then joins it again',
      () async {
        final mailbox = FakeMailbox();
        final rtc = FakeRtc();
        final api = FakeGlobalApi(mailbox, [paused, paused, pc('PCPCPC')]);
        final host = await fakePc(api, rtc, 'PCPCPC');
        final slept = <Duration>[];
        final statuses = <String>[];
        final next = await launcher(
          api,
          rtc,
          slept,
        ).awaitHostPc(world, stillPaused: () => true, onStatus: statuses.add);
        expect(next, isNotNull);
        expect(next!.client?.hostKind, HostKind.pc);
        expect(next.client?.code, 'PCPCPC');
        expect(next.globalWorld, world);
        expect(api.claims, 3);
        expect(slept, everyElement(pausePoll));
        expect(statuses.first, pausedText);
        await next.dispose();
        await host.dispose();
      },
    );

    test(
      'a pause lifted over the same link ends the wait with nothing to do',
      () async {
        final api = FakeGlobalApi(FakeMailbox(), [paused]);
        var polls = 0;
        final next = await launcher(
          api,
          FakeRtc(),
          [],
        ).awaitHostPc(world, stillPaused: () => ++polls < 3);
        expect(next, isNull);
      },
    );

    test(
      'an unreachable site is waited out, and a swept seat is taken again',
      () async {
        final mailbox = FakeMailbox();
        final rtc = FakeRtc();
        final api = FakeGlobalApi(mailbox, [
          const ApiError(0, 'offline'),
          const ApiError(404, 'no seat'),
          pc('PCPCPC'),
        ]);
        final host = await fakePc(api, rtc, 'PCPCPC');
        final next = await launcher(
          api,
          rtc,
          [],
        ).awaitHostPc(world, stillPaused: () => true);
        expect(next?.client?.code, 'PCPCPC');
        expect(api.joins, [world]);
        await next?.dispose();
        await host.dispose();
      },
    );

    test(
      'a world closed while we wait ends the wait with its message',
      () async {
        final api = FakeGlobalApi(FakeMailbox(), [paused, offline]);
        await expectLater(
          launcher(
            api,
            FakeRtc(),
            [],
          ).awaitHostPc(world, stillPaused: () => true),
          throwsA(isA<WorldOfflineError>()),
        );
        final swept = FakeGlobalApi(FakeMailbox(), [
          const ApiError(404, 'no seat'),
          const ApiError(
            409,
            "This world is offline — its host PC isn't running.",
          ),
        ]);
        await expectLater(
          launcher(
            swept,
            FakeRtc(),
            [],
          ).awaitHostPc(world, stillPaused: () => true),
          throwsA(isA<WorldOfflineError>()),
        );
      },
    );

    test('entering an offline world is refused', () async {
      final api = FakeGlobalApi(FakeMailbox(), [offline]);
      await expectLater(
        launcher(api, FakeRtc(), []).enterGlobal(world),
        throwsA(isA<WorldOfflineError>()),
      );
      expect(api.joins, [world]);
    });

    test(
      'entering while the PC is paused waits for as long as it takes',
      () async {
        final mailbox = FakeMailbox();
        final rtc = FakeRtc();
        final polls = (const Duration(hours: 2).inSeconds / pausePoll.inSeconds)
            .ceil();
        final api = FakeGlobalApi(mailbox, [
          for (var i = 0; i < polls; i++) paused,
          pc('PCPCPC'),
        ]);
        final host = await fakePc(api, rtc, 'PCPCPC');
        var waited = Duration.zero;
        final l = Launcher(
          api: api,
          rtc: rtc,
          player: const LocalPlayer(name: 'Ana', userId: 1),
          sleep: (d) async => waited += d,
        );
        final launch = await l.enterGlobal(world);
        expect(launch.client?.hostKind, HostKind.pc);
        expect(launch.globalWorld, world);
        expect(waited, greaterThanOrEqualTo(const Duration(hours: 2)));
        await launch.dispose();
        await host.dispose();
      },
    );
  });
}
