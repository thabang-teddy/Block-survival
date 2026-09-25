/// How a run starts — the lobby's handlers from `ui/MainMenu.tsx` and the
/// global-world queue logic from `net/globalWorld.ts`, without any widget.
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

const Duration claimPoll = Duration(seconds: 3);
const Duration handoverTimeout = Duration(seconds: 90);

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
  });

  final Game game;
  final WorldKind worldKind;
  final HostSession? host;
  final ClientSession? client;

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
    DateTime Function()? now,
  }) : _sleep = sleep ?? ((d) => Future<void>.delayed(d)),
       _now = now ?? DateTime.now;

  final GameApi api;
  final RtcFactory rtc;
  final LocalPlayer player;
  final Future<void> Function(Duration) _sleep;
  final DateTime Function() _now;

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

  /// the global world: host it if nobody is, otherwise join whoever is
  Future<Launch> enterGlobal({void Function(String)? onStatus}) async =>
      _settle(await api.joinGlobal(), null, null, onStatus);

  /// the global host left: keep our seat and follow the queue
  Future<Launch> handover(
    SavedPlayer? mine,
    String oldCode, {
    void Function(String)? onStatus,
  }) async => _settle(await api.claimGlobal(), mine, oldCode, onStatus);

  /// The host PC went quiet while we were in its world: the game is frozen.
  /// Every [pausePoll] we ask the server (which also keeps our seat): while the
  /// PC is paused we wait, however long; once it is back we join it again, into
  /// the spot we left; if it was released to the players we follow the queue.
  /// [stillPaused] false means the old link came back by itself (the PC only
  /// froze), and null is returned: carry on as is.
  Future<Launch?> awaitHostPc(
    SavedPlayer? mine, {
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
          state = await api.joinGlobal();
        } else if (e.status == 0 || e.status >= 500) {
          // the site itself may be unreachable from here for a while
          continue;
        } else {
          rethrow;
        }
      }
      if (state is GlobalPaused) continue;
      if (!stillPaused()) return null;
      if (state case GlobalClient(:final room, hostKind: HostKind.pc)) {
        // for up to 45 s after the PC dies the server still counts it as
        // online: an unanswered join is more waiting
        try {
          onStatus?.call('Joining the host PC…');
          return await join(room.code, WorldKind.global, hostKind: HostKind.pc);
        } on Object {
          onStatus?.call(pausedText);
          continue;
        }
      }
      return _settle(state, mine, null, onStatus);
    }
  }

  Future<Launch> _settle(
    GlobalState first,
    SavedPlayer? mine,
    String? oldCode,
    void Function(String)? onStatus,
  ) async {
    var deadline = _now().add(handoverTimeout);
    var state = first;
    for (;;) {
      switch (state) {
        case GlobalHost():
          return _hostGlobal(mine, onStatus);
        // the host PC's room is the same one after a pause: going back in is the point
        case GlobalClient(:final room, hostKind: HostKind.pc):
          onStatus?.call('Joining the host PC…');
          return join(room.code, WorldKind.global, hostKind: HostKind.pc);
        case GlobalClient(:final room) when room.code != oldCode:
          onStatus?.call('Joining…');
          return join(room.code, WorldKind.global);
        case GlobalPaused():
          // the PC holds the world and will be back: no deadline while we wait
          onStatus?.call(pausedText);
          await _sleep(pausePoll);
          deadline = _now().add(handoverTimeout);
          state = await api.claimGlobal();
          continue;
        case GlobalPending(:final hostName):
          onStatus?.call('Waiting for $hostName to open the world…');
        case GlobalClient():
          onStatus?.call('Waiting for the next host…');
      }
      if (!_now().isBefore(deadline)) {
        throw StateError(
          'Nobody opened the global world in time — try again from the lobby.',
        );
      }
      await _sleep(claimPoll);
      state = await api.claimGlobal();
    }
  }

  Future<Launch> _hostGlobal(
    SavedPlayer? mine,
    void Function(String)? onStatus,
  ) async {
    onStatus?.call('Loading the world…');
    SaveData? restore;
    try {
      final json = await api.loadWorld(kind: WorldKind.global);
      if (json != null) restore = SaveData.fromJson(json);
    } on ApiError {
      restore = null;
    }
    if (restore != null && mine != null) {
      restore = SaveData(
        seed: restore.seed,
        time: restore.time,
        edits: restore.edits,
        players: {...restore.players, player.saveKey: mine},
        zombies: restore.zombies,
        drops: restore.drops,
        crates: restore.crates,
        savedAt: restore.savedAt,
      );
    }
    final session = HostSession(api, rtc);
    await session.listen(player.name, WorldKind.global);
    final game = Game(
      seed: globalSeed,
      local: player,
      role: Role.host,
      worldKind: WorldKind.global,
      rules: await _rules(),
      restore: restore,
    );
    session.attach(game);
    return Launch(game: game, worldKind: WorldKind.global, host: session);
  }
}
