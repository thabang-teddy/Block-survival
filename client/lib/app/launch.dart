/// How a run starts — the lobby's handlers from `ui/MainMenu.tsx` and the
/// global-world logic from `net/globalWorld.ts`, without any widget.
library;

import 'dart:async';

import 'package:block_survival/api/api_client.dart';
import 'package:block_survival/api/game_api.dart';
import 'package:block_survival/api/models.dart';
import 'package:block_survival/game/game.dart';
import 'package:block_survival/game/rules.dart';
import 'package:block_survival/game/save.dart';
import 'package:block_survival/game/ui_state.dart';
import 'package:block_survival/net/client_session.dart';
import 'package:block_survival/net/host_session.dart';
import 'package:block_survival/net/protocol.dart';
import 'package:block_survival/net/rtc.dart';
import 'package:block_survival/world/seed.dart';

/// how often a player waiting on the paused host PC asks whether it is back
/// (it may take hours — docs/pc-host-research.md §5.4)
const Duration pausePoll = Duration(seconds: 5);
const String pausedText = 'Host PC offline, game paused, reconnecting…';

/// what the play page is handed: a game plus whatever session drives it
final class Launch {
  const Launch({
    required this.game,
    required this.worldKind,
    this.host,
    this.client,
    this.globalWorld,
  });

  final Game game;
  final WorldKind worldKind;
  final HostSession? host;
  final ClientSession? client;

  /// which global world (its host key's id), for a reconnect
  final int? globalWorld;

  Launch inGlobalWorld(int world) => Launch(
    game: game,
    worldKind: worldKind,
    host: host,
    client: client,
    globalWorld: world,
  );

  Role get role => client == null ? Role.host : Role.client;
  String? get roomCode => host?.online == true ? host!.code : client?.code;

  Future<void> dispose() async {
    await host?.dispose();
    await client?.dispose();
    game.dispose();
  }
}

/// builds launches for the lobby; the API and WebRTC come in so tests can fake them
final class Launcher {
  Launcher({
    required this.api,
    required this.rtc,
    required this.player,
    Future<void> Function(Duration)? sleep,
  }) : _sleep = sleep ?? ((d) => Future<void>.delayed(d));

  final GameApi api;
  final RtcFactory rtc;
  final LocalPlayer player;
  final Future<void> Function(Duration) _sleep;

  /// the admin's clock and zombie schedule; a server without the endpoint
  /// (or a failed call) means the defaults
  Future<GameRules> _rules() async {
    try {
      return await api.rules();
    } on ApiError {
      return GameRules.defaults;
    }
  }

  /// the player's own saved world, if there is one; the host continues from it
  Future<SaveData?> _restoreOwn(bool hasSave) async {
    if (!hasSave) return null;
    final json = await api.loadWorld();
    return json == null ? null : SaveData.fromJson(json);
  }

  Future<Launch> solo({required bool hasSave}) async {
    final restore = await _restoreOwn(hasSave);
    final game = Game(
      seed: restore?.seed ?? newWorldSeed(),
      local: player,
      role: Role.host,
      worldKind: WorldKind.own,
      rules: await _rules(),
      restore: restore,
    );
    final session = HostSession(api, rtc)..attach(game);
    return Launch(game: game, worldKind: WorldKind.own, host: session);
  }

  Future<Launch> host({required bool hasSave}) async {
    final restore = await _restoreOwn(hasSave);
    final session = HostSession(api, rtc);
    await session.listen(player.name, WorldKind.own);
    final game = Game(
      seed: restore?.seed ?? newWorldSeed(),
      local: player,
      role: Role.host,
      worldKind: WorldKind.own,
      rules: await _rules(),
      restore: restore,
    );
    session.attach(game);
    return Launch(game: game, worldKind: WorldKind.own, host: session);
  }

  /// accept the invitation (which unlocks the room for us) and join
  Future<Launch> acceptInvite(Invite invite) async {
    await api.acceptInvite(invite.id);
    return join(invite.code, invite.worldKind);
  }

  Future<Launch> join(
    String code,
    WorldKind worldKind, {
    HostKind hostKind = HostKind.browser,
  }) async {
    final session = ClientSession(
      api,
      rtc,
      code,
      player.name,
      userId: player.userId,
      hostKind: hostKind,
    );
    final Welcome welcome;
    try {
      welcome = await session.connect();
    } on Object {
      await session.dispose();
      rethrow;
    }
    final game = Game(
      seed: welcome.seed,
      local: player,
      role: Role.client,
      worldKind: worldKind,
      rules: welcome.rules ?? await _rules(),
    );
    game.dayNight.time = welcome.time;
    for (final e in welcome.edits) {
      game.applyEdit(e);
    }
    game.spawn = welcome.spawn;
    game.player.teleport(welcome.spawn.x, welcome.spawn.y, welcome.spawn.z);
    session.attach(game);
    return Launch(game: game, worldKind: worldKind, client: session);
  }

  /// a global world: join its host PC, or wait for it while it is paused
  Future<Launch> enterGlobal(
    int world, {
    void Function(String)? onStatus,
  }) async => _settle(await api.joinGlobal(world), onStatus);

  /// The host PC went quiet while we were in its world: the game is frozen.
  /// Every [pausePoll] we ask the server (which also keeps our seat): while the
  /// PC is paused we wait, however long; once it is back we join it again, into
  /// the spot we left; if its world closed meanwhile, [WorldOfflineError].
  /// [stillPaused] false means the old link came back by itself (the PC only
  /// froze), and null is returned: carry on as is.
  Future<Launch?> awaitHostPc(
    int world, {
    required bool Function() stillPaused,
    void Function(String)? onStatus,
  }) async {
    onStatus?.call(pausedText);
    for (;;) {
      await _sleep(pausePoll);
      if (!stillPaused()) return null;
      GlobalState state;
      try {
        state = await api.claimGlobal();
      } on ApiError catch (e) {
        if (e.status == 404) {
          // our seat went: the world closed, or we slept through the sweep
          state = await _joinOrOffline(world);
        } else if (e.status == 0 || e.status >= 500) {
          // the site itself may be unreachable from here for a while
          continue;
        } else {
          rethrow;
        }
      }
      if (state is GlobalPaused) continue;
      if (!stillPaused()) return null;
      switch (state) {
        case GlobalOffline(:final message):
          throw WorldOfflineError(message);
        case GlobalClient(:final room, :final world):
          // for up to 45 s after the PC dies the server still counts it as
          // online: an unanswered join is more waiting
          try {
            return await _joinPc(room.code, world, onStatus);
          } on Object {
            onStatus?.call(pausedText);
          }
        case GlobalPaused():
          continue;
      }
    }
  }

  Future<GlobalState> _joinOrOffline(int world) async {
    try {
      return await api.joinGlobal(world);
    } on ApiError catch (e) {
      if (e.status == 409) throw WorldOfflineError(e.message);
      rethrow;
    }
  }

  Future<Launch> _settle(
    GlobalState first,
    void Function(String)? onStatus,
  ) async {
    var state = first;
    for (;;) {
      switch (state) {
        case GlobalOffline(:final message):
          throw WorldOfflineError(message);
        case GlobalClient(:final room, :final world):
          return _joinPc(room.code, world, onStatus);
        case GlobalPaused():
          // the PC runs the world and will be back: no deadline while we wait
          onStatus?.call(pausedText);
          await _sleep(pausePoll);
          state = await api.claimGlobal();
      }
    }
  }

  Future<Launch> _joinPc(
    String code,
    int world,
    void Function(String)? onStatus,
  ) async {
    onStatus?.call('Joining the host PC…');
    final launch = await join(code, WorldKind.global, hostKind: HostKind.pc);
    return launch.inGlobalWorld(world);
  }
}

/// the global world closed (its PC stopped or was marked offline)
final class WorldOfflineError implements Exception {
  const WorldOfflineError(this.message);

  final String message;

  @override
  String toString() => message;
}
