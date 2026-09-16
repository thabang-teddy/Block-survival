/// Host side of a match — twin of `net/HostSession.ts`. Solo play is a
/// HostSession with no transport ("host with zero peers"). Accepts joiners,
/// hands them the world diff, applies their block edits and broadcasts
/// snapshots at [snapshotHz]. Remote players are tracked for the scoreboard
/// and mirrored in snapshots; their combat and inventory arrive with P2.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:block_survival/api/api_client.dart';
import 'package:block_survival/api/game_api.dart';
import 'package:block_survival/game/game.dart';
import 'package:block_survival/game/ui_state.dart';
import 'package:block_survival/net/protocol.dart';
import 'package:block_survival/net/rtc.dart';
import 'package:block_survival/net/transport.dart';
import 'package:block_survival/world/seed.dart';

/// how often the host refreshes its room row on the API (seconds); in the
/// global world this is also the heartbeat that keeps everyone's seat
const double roomRefreshSeconds = 15;

final class RemotePlayer {
  RemotePlayer({
    required this.id,
    required this.name,
    this.userId,
    required this.spawn,
  });

  final String id;
  final String name;
  final int? userId;
  Vec3 spawn;
  double x = 0;
  double y = 0;
  double z = 0;
  double yaw = 0;
  double pitch = 0;
  String anim = 'Idle';
  int kills = 0;
  int deaths = 0;

  PlayerSnap snap() => PlayerSnap(
    id: id,
    name: name,
    x: x,
    y: y,
    z: z,
    yaw: yaw,
    pitch: pitch,
    anim: anim,
    held: null,
    health: 100,
    dead: false,
    kills: kills,
    deaths: deaths,
  );
}

final class HostSession implements TransportEvents {
  HostSession(this._api, this._rtc, {String? code})
    : code = code ?? makeRoomCode();

  final GameApi _api;
  final RtcFactory _rtc;
  final String code;
  HostTransport? _transport;
  Game? _game;
  WorldKind _worldKind = WorldKind.own;
  final Set<String> _pending = {};
  final Map<String, RemotePlayer> players = {};
  final List<BlockEdit> _outgoing = [];
  double _snapshotTimer = 0;
  double _roomRefreshTimer = 0;

  /// the server no longer counts us as the global world's host (its queue moved on)
  void Function(String reason)? onLost;
  void Function()? onPlayersChanged;

  bool get online => _transport != null;
  int get playerCount => players.length + 1;

  void attach(Game game) {
    _game = game;
    game.onEdit = _outgoing.add;
    game.remotePlayers = const [];
  }

  /// Open the room: register the code → host id with the app so joiners can
  /// resolve it, then start reading the room's mailbox.
  Future<void> listen(String hostName, WorldKind worldKind) async {
    if (_transport != null) return;
    final t = HostTransport(_api, _rtc, this);
    await _api.createRoom(code, t.id, hostName, worldKind: worldKind);
    t.listen(code);
    _transport = t;
    _worldKind = worldKind;
  }

  void tick(double dt) {
    final game = _game;
    final t = _transport;
    if (game == null || t == null) return;
    _roomRefreshTimer += dt;
    if (_roomRefreshTimer >= roomRefreshSeconds) {
      _roomRefreshTimer = 0;
      final userIds = [
        if (game.local.userId != null) game.local.userId!,
        for (final p in players.values)
          if (p.userId != null) p.userId!,
      ];
      unawaited(
        _api
            .refreshRoom(code, t.id, playerCount, userIds: userIds)
            .catchError(_onRefreshFailed),
      );
    }
    if (_outgoing.isNotEmpty) {
      t.broadcast(encodeHost(Blocks(List.of(_outgoing))));
      _outgoing.clear();
    }
    _snapshotTimer += dt;
    if (_snapshotTimer >= 1 / snapshotHz) {
      _snapshotTimer = 0;
      t.broadcast(encodeHost(_snapshot(game)));
    }
  }

  Snapshot _snapshot(Game game) {
    final s = game.player.state;
    return Snapshot(
      time: game.time,
      players: [
        PlayerSnap(
          id: 'host',
          name: game.local.name,
          x: s.x,
          y: s.y,
          z: s.z,
          yaw: s.yaw,
          pitch: s.pitch,
          anim: 'Idle',
          held: game.held?.id,
          health: game.health,
          dead: false,
          kills: game.kills,
          deaths: game.deaths,
        ),
        for (final p in players.values) p.snap(),
      ],
      zombies: const [],
      drops: const [],
      crates: const [],
    );
  }

  void _onRefreshFailed(Object e) {
    // a refresh the server refused outright means the global world has a new host
    if (_worldKind != WorldKind.global || e is! ApiError) return;
    if (e.status == 404 || e.status == 409) onLost?.call(e.message);
  }

  @override
  void onOpen(Link link) => _pending.add(link.id);

  @override
  void onData(Link link, Uint8List bytes) {
    final game = _game;
    if (game == null) return;
    final ClientMessage msg;
    try {
      msg = decodeClient(bytes);
    } on Object {
      return;
    }
    if (_pending.contains(link.id)) {
      if (msg is! Hello || msg.v != protocolVersion) return;
      _pending.remove(link.id);
      if (playerCount >= maxPlayers) {
        link.send(encodeHost(const Full()));
        unawaited(link.close());
        return;
      }
      final name = msg.name.isEmpty
          ? 'Player'
          : msg.name.substring(0, msg.name.length > 16 ? 16 : msg.name.length);
      final player = RemotePlayer(
        id: link.id,
        name: name,
        userId: msg.userId,
        spawn: game.spawn,
      );
      players[link.id] = player;
      link.send(
        encodeHost(
          Welcome(
            v: protocolVersion,
            you: link.id,
            seed: game.seed,
            time: game.time,
            edits: game.world.edits.values
                .map((e) => BlockEdit(x: e.x, y: e.y, z: e.z, id: e.id))
                .toList(),
            spawn: game.spawn,
          ),
        ),
      );
      link.send(
        encodeHost(
          PrivateState(
            inventory: const [],
            magazine: 0,
            health: 100,
            spawn: game.spawn,
          ),
        ),
      );
      game.toast('$name joined');
      _playersChanged(game);
      return;
    }
    final player = players[link.id];
    if (player == null) return;
    switch (msg) {
      case InputMessage(
        :final x,
        :final y,
        :final z,
        :final yaw,
        :final pitch,
        :final anim,
      ):
        player
          ..x = x
          ..y = y
          ..z = z
          ..yaw = yaw
          ..pitch = pitch
          ..anim = anim;
      case BreakBlock(:final x, :final y, :final z):
        // P2 brings hardness and drops; until then a client's dig is honoured as-is
        game.applyEdit(BlockEdit(x: x, y: y, z: z, id: 0));
        _outgoing.add(BlockEdit(x: x, y: y, z: z, id: 0));
        game.needsSave = true;
      case ClientChat(:final text):
        _transport?.broadcast(encodeHost(HostChat(player.name, text)));
        game.toast('${player.name}: $text');
      default:
        break;
    }
  }

  @override
  void onClose(Link link) {
    _pending.remove(link.id);
    final player = players.remove(link.id);
    final game = _game;
    if (player != null && game != null) {
      game.toast('${player.name} left');
      _playersChanged(game);
    }
  }

  void _playersChanged(Game game) {
    game.remotePlayers = [
      for (final p in players.values)
        ScoreRow(
          id: p.id,
          name: p.name,
          score: 0,
          kills: p.kills,
          deaths: p.deaths,
          you: false,
        ),
    ];
    onPlayersChanged?.call();
  }

  Future<void> dispose() async {
    final t = _transport;
    if (t != null) {
      t.broadcast(encodeHost(const Bye()));
      unawaited(_api.closeRoom(code, t.id).catchError((Object _) {}));
      await t.dispose();
    }
    _transport = null;
    _game?.onEdit = null;
  }
}
