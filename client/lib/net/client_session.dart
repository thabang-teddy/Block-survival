/// Client side of a match — twin of `net/ClientSession.ts`. Connects to the
/// host through the rooms API + WebRTC, says hello, builds the world from the
/// welcome (seed + edits) and then follows snapshots, block edits and private
/// state. Its own movement is authoritative and goes up at [inputHz].
///
/// With the host PC (docs/pc-host-research.md §5.4) a silence or a dropped
/// link is a pause, not the end: the session goes [ClientStatus.paused] (the
/// game holds the player still and the play page waits for the PC), and
/// snapshots arriving again on the same link lift it.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:block_survival/api/game_api.dart';
import 'package:block_survival/api/models.dart';
import 'package:block_survival/game/game.dart';
import 'package:block_survival/game/host_sim.dart';
import 'package:block_survival/game/score.dart';
import 'package:block_survival/game/ui_state.dart';
import 'package:block_survival/net/protocol.dart';
import 'package:block_survival/net/rtc.dart';
import 'package:block_survival/net/transport.dart';

enum ClientStatus { connecting, joined, paused, full, hostLeft, error }

/// a PC-hosted game that sends no snapshot for this long is paused
const Duration pauseAfterSilence = Duration(seconds: 3);

final class ClientSession implements TransportEvents {
  ClientSession(
    this._api,
    this._rtc,
    this.code,
    this.name, {
    this.userId,
    this.hostKind = HostKind.browser,
    Duration Function()? clock,
  }) : _clock = clock ?? _monotonic;

  static final Stopwatch _watch = Stopwatch()..start();
  static Duration _monotonic() => _watch.elapsed;

  /// who runs the world at the other end
  final HostKind hostKind;
  final Duration Function() _clock;
  Duration _lastSnapAt = Duration.zero;

  /// the host PC went quiet: the game holds still until it is back
  bool get paused => status == ClientStatus.paused;

  final GameApi _api;
  final RtcFactory _rtc;
  final String code;
  final String name;
  final int? userId;
  ClientTransport? _transport;
  Link? _link;
  Game? _game;
  ClientStatus status = ClientStatus.connecting;
  String error = '';
  double _inputTimer = 0;
  Completer<Welcome>? _welcome;

  /// the id the host gave us (`welcome.you`); snapshots list us under it
  String? _you;

  void Function(ClientStatus status)? onStatus;

  /// the player list from the last snapshot, for the scoreboard
  List<ScoreRow> players = const [];

  /// Resolve the host, offer it a DataChannel, say hello and wait for the
  /// welcome that carries the world.
  Future<Welcome> connect({Duration timeout = connectTimeout}) async {
    final t = ClientTransport(_api, _rtc, this);
    _transport = t;
    _welcome = Completer<Welcome>();
    try {
      _link = await t.connect(code, timeout: timeout);
    } on Object catch (e) {
      _fail(e.toString());
      rethrow;
    }
    _link!.send(
      encodeClient(Hello(v: protocolVersion, name: name, userId: userId)),
    );
    return _welcome!.future.timeout(
      timeout,
      onTimeout: () {
        _fail('The host did not answer');
        throw StateError('The host did not answer');
      },
    );
  }

  void attach(Game game) {
    _game = game;
    game.onAction = _send;
  }

  void tick(double dt) {
    if (status == ClientStatus.joined &&
        hostKind == HostKind.pc &&
        _clock() - _lastSnapAt > pauseAfterSilence) {
      _setStatus(ClientStatus.paused);
    }
    // paused: nothing is sent — the world is not moving, so neither are we
    final game = _game;
    if (game == null || status != ClientStatus.joined) return;
    _inputTimer += dt;
    if (_inputTimer < 1 / inputHz) return;
    _inputTimer = 0;
    final s = game.player.state;
    _send(
      InputMessage(
        x: s.x,
        y: s.y,
        z: s.z,
        yaw: s.yaw,
        pitch: s.pitch,
        anim: game.me.anim,
        slot: game.hotbarSlot,
        aiming: game.me.aiming,
      ),
    );
  }

  void chat(String text) => _send(ClientChat(text));

  void _send(ClientMessage m) => _link?.send(encodeClient(m));

  void _setStatus(ClientStatus s) {
    status = s;
    onStatus?.call(s);
  }

  void _fail(String reason) {
    error = reason;
    _setStatus(ClientStatus.error);
    final w = _welcome;
    if (w != null && !w.isCompleted) w.completeError(StateError(reason));
  }

  @override
  void onOpen(Link link) {}

  @override
  void onData(Link link, Uint8List bytes) {
    final HostMessage msg;
    try {
      msg = decodeHost(bytes);
    } on Object {
      return;
    }
    final game = _game;
    switch (msg) {
      case Welcome():
        if (msg.v != protocolVersion) {
          _fail('The host runs another version of the game');
          return;
        }
        _lastSnapAt = _clock();
        _setStatus(ClientStatus.joined);
        _you = msg.you;
        final w = _welcome;
        if (w != null && !w.isCompleted) w.complete(msg);
      case Full():
        _setStatus(ClientStatus.full);
        error = 'The game is full';
        final w = _welcome;
        if (w != null && !w.isCompleted) w.completeError(StateError(error));
      case Bye():
        // the PC restarting or handing the world over: wait for the server's
        // word (the play page follows it); a player host has simply left
        _setStatus(
          hostKind == HostKind.pc ? ClientStatus.paused : ClientStatus.hostLeft,
        );
      case Snapshot(:final players, :final time):
        _lastSnapAt = _clock();
        // the PC froze the world and carried on over the same link
        if (status == ClientStatus.paused && _link != null) {
          _setStatus(ClientStatus.joined);
        }
        if (game == null) return;
        game.dayNight.time = time;
        game.sim.applySnapshot(msg);
        this.players = [
          for (final p in players)
            if (p.id != _you)
              ScoreRow(
                id: p.id,
                name: p.name,
                score: computeScore(game.nightsSurvived, p.kills),
                kills: p.kills,
                deaths: p.deaths,
                you: false,
              )
            else
              // the host's word on our own score
              ScoreRow(
                id: p.id,
                name: p.name,
                score: computeScore(game.nightsSurvived, p.kills),
                kills: p.kills,
                deaths: p.deaths,
                you: true,
              ),
        ];
        final mine = this.players.where((p) => p.you).firstOrNull;
        if (mine != null) {
          game.me
            ..kills = mine.kills
            ..deaths = mine.deaths;
        }
        game.remotePlayers = this.players.where((p) => !p.you).toList();
        game.remotePoses = [
          for (final p in players)
            if (p.id != _you)
              PlayerPose(id: p.id, name: p.name, x: p.x, y: p.y, z: p.z),
        ];
      case PrivateState():
        if (game == null) return;
        _applyPrivate(game, msg);
      case Blocks(:final edits):
        if (game == null) return;
        for (final e in edits) {
          game.applyEdit(e);
        }
      case HostChat(:final from, :final text):
        game?.toast('$from: $text');
    }
  }

  /// what the host tells only us (Avatar.push on the host side)
  void _applyPrivate(Game game, PrivateState msg) {
    final me = game.me;
    final inventory = msg.inventory;
    if (inventory != null) me.inventory.replace(inventory);
    final magazine = msg.magazine;
    if (magazine != null) me.magazine = magazine;
    final reloading = msg.reloading;
    if (reloading != null) {
      me.reloadUntil = reloading ? game.time + RifleTuning.reloadSeconds : 0;
    }
    final health = msg.health;
    if (health != null) me.health = health;
    final poisoned = msg.poisoned;
    if (poisoned != null) {
      me.poisonUntil = poisoned ? game.time + PoisonTuning.seconds : 0;
    }
    if (msg.hurtAt != null) me.hurtAt = game.time;
    final dead = msg.dead;
    if (dead != null) {
      if (dead && !me.dead) game.onLocalDeath();
      me.dead = dead;
    }
    final respawnIn = msg.respawnIn;
    if (respawnIn != null) me.respawnAt = game.time + respawnIn;
    final spawn = msg.spawn;
    if (spawn != null) me.spawn = spawn;
    final teleport = msg.teleport;
    if (teleport != null) game.onLocalRespawn(teleport);
    final message = msg.message;
    if (message != null) game.toast(message);
  }

  @override
  void onClose(Link link) {
    _link = null;
    // the host PC dropped out: paused until it is back; a player host is gone for good
    if (hostKind == HostKind.pc &&
        (status == ClientStatus.joined || status == ClientStatus.paused)) {
      _setStatus(ClientStatus.paused);
      return;
    }
    if (status == ClientStatus.joined) _setStatus(ClientStatus.hostLeft);
    if (status == ClientStatus.connecting) {
      _fail('The connection to the host dropped');
    }
  }

  Future<void> dispose() async {
    _game?.onEdit = null;
    await _transport?.dispose();
    _transport = null;
    _link = null;
  }
}
