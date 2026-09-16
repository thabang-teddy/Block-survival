/// Client side of a match — twin of `net/ClientSession.ts`. Connects to the
/// host through the rooms API + WebRTC, says hello, builds the world from the
/// welcome (seed + edits) and then follows snapshots, block edits and private
/// state. Its own movement is authoritative and goes up at [inputHz].
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:block_survival/api/game_api.dart';
import 'package:block_survival/game/game.dart';
import 'package:block_survival/game/ui_state.dart';
import 'package:block_survival/net/protocol.dart';
import 'package:block_survival/net/rtc.dart';
import 'package:block_survival/net/transport.dart';

enum ClientStatus { connecting, joined, full, hostLeft, error }

final class ClientSession implements TransportEvents {
  ClientSession(this._api, this._rtc, this.code, this.name, {this.userId});

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
    game.onEdit = (e) => _send(BreakBlock(e.x, e.y, e.z));
  }

  void tick(double dt) {
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
        anim: s.sprinting ? 'Run' : 'Idle',
        slot: game.hotbarSlot,
        aiming: false,
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
        _setStatus(ClientStatus.joined);
        final w = _welcome;
        if (w != null && !w.isCompleted) w.complete(msg);
      case Full():
        _setStatus(ClientStatus.full);
        error = 'The game is full';
        final w = _welcome;
        if (w != null && !w.isCompleted) w.completeError(StateError(error));
      case Bye():
        _setStatus(ClientStatus.hostLeft);
      case Snapshot(:final players, :final time):
        if (game == null) return;
        game.dayNight.time = time;
        this.players = [
          for (final p in players)
            if (p.id != link.id)
              ScoreRow(
                id: p.id,
                name: p.name,
                score: 0,
                kills: p.kills,
                deaths: p.deaths,
                you: false,
              ),
        ];
        game.remotePlayers = this.players;
      case PrivateState():
        if (game == null) return;
        if (msg.inventory != null) game.inventory.replace(msg.inventory!);
        if (msg.health != null) game.health = msg.health!;
        if (msg.spawn != null) game.spawn = msg.spawn!;
        if (msg.teleport != null) {
          final t = msg.teleport!;
          game.player.teleport(t.x, t.y, t.z);
        }
        if (msg.message != null) game.toast(msg.message!);
      case Blocks(:final edits):
        if (game == null) return;
        for (final e in edits) {
          game.applyEdit(e);
        }
      case HostChat(:final from, :final text):
        game?.toast('$from: $text');
    }
  }

  @override
  void onClose(Link link) {
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
