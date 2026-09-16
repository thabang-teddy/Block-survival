/// In-memory stand-ins for the rooms API mailbox and for WebRTC, so the
/// signalling cadence and the host/client handshake run without a network.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:block_survival/api/api_client.dart';
import 'package:block_survival/api/game_api.dart';
import 'package:block_survival/api/models.dart';
import 'package:block_survival/net/rtc.dart';
import 'package:block_survival/world/seed.dart';

/// the server's signal mailbox: rows in insertion order, filtered by `to`
final class FakeMailbox {
  final List<SignalRow> rows = [];
  final List<({String from, String to, String type})> sent = [];
  int _nextId = 1;

  /// scripted failures for the next polls (status codes); 0 = network down
  final List<int> pollFailures = [];
  final List<int> sendFailures = [];
  int polls = 0;

  void post(String from, String to, String type, Map<String, dynamic> data) {
    rows.add(SignalRow(id: _nextId++, from: from, type: type, data: data));
    sent.add((from: from, to: to, type: type));
    _to[rows.last.id] = to;
  }

  final Map<int, String> _to = {};

  List<SignalRow> fetch(String to, int after, {int page = 50}) =>
      rows.where((r) => r.id > after && _to[r.id] == to).take(page).toList();
}

/// only the endpoints the transport uses
final class FakeSignalApi implements GameApiSignals {
  FakeSignalApi(this.mailbox, {this.hostPeerId = 'hostAAAAAAAA'});

  final FakeMailbox mailbox;
  final String hostPeerId;

  @override
  Future<RoomInfo> resolveRoom(String code) async => RoomInfo(
    code: code,
    hostPeerId: hostPeerId,
    hostName: 'Host',
    worldKind: WorldKind.own,
    players: 1,
    expiresAt: '',
  );

  @override
  Future<void> signal(
    String code, {
    required String from,
    required String to,
    required String type,
    required Map<String, dynamic> data,
  }) async {
    if (mailbox.sendFailures.isNotEmpty) {
      final status = mailbox.sendFailures.removeAt(0);
      throw ApiError(status, 'send failed');
    }
    mailbox.post(from, to, type, data);
  }

  @override
  Future<List<SignalRow>> signals(
    String code, {
    required String to,
    required int after,
  }) async {
    mailbox.polls++;
    if (mailbox.pollFailures.isNotEmpty) {
      final status = mailbox.pollFailures.removeAt(0);
      throw ApiError(status, 'poll failed');
    }
    return mailbox.fetch(to, after);
  }
}

// ---------------------------------------------------------------- fake WebRTC

/// two peers created by the same factory are wired back to back: the second
/// peer's offer/answer reach the first, and a channel created on one appears
/// on the other once both descriptions are set
final class FakeRtc implements RtcFactory {
  final List<FakePeer> peers = [];

  @override
  Future<RtcPeer> createPeer() async {
    final p = FakePeer(this);
    peers.add(p);
    return p;
  }

  FakePeer? other(FakePeer me) {
    for (final p in peers) {
      if (p != me && !p.closed) return p;
    }
    return null;
  }
}

final class FakePeer implements RtcPeer {
  FakePeer(this._rtc);

  final FakeRtc _rtc;
  final StreamController<SignalData> _candidates = StreamController.broadcast();
  final StreamController<RtcChannel> _remoteChannels =
      StreamController.broadcast();
  final StreamController<String> _states = StreamController.broadcast();
  final List<FakeChannel> _localChannels = [];
  bool closed = false;
  bool remoteSet = false;
  bool localSet = false;
  final List<SignalData> receivedCandidates = [];

  @override
  Stream<SignalData> get localCandidates => _candidates.stream;

  @override
  Stream<RtcChannel> get remoteChannels => _remoteChannels.stream;

  @override
  Stream<String> get connectionState => _states.stream;

  @override
  Future<RtcChannel> createDataChannel(String label) async {
    final c = FakeChannel(label);
    _localChannels.add(c);
    _tryConnect();
    return c;
  }

  @override
  Future<SignalData> createOffer() async {
    localSet = true;
    _candidates.add({
      'candidate': 'cand-of-offerer',
      'sdpMid': '0',
      'sdpMLineIndex': 0,
    });
    return {'type': 'offer', 'sdp': 'v=0 offer'};
  }

  @override
  Future<SignalData> createAnswer() async {
    localSet = true;
    _candidates.add({
      'candidate': 'cand-of-answerer',
      'sdpMid': '0',
      'sdpMLineIndex': 0,
    });
    _tryConnect();
    return {'type': 'answer', 'sdp': 'v=0 answer'};
  }

  @override
  Future<void> setRemoteDescription(SignalData description) async {
    remoteSet = true;
    _tryConnect();
  }

  @override
  Future<void> addIceCandidate(SignalData candidate) async {
    receivedCandidates.add(candidate);
  }

  /// once both sides have both descriptions, open every local channel and
  /// mirror it on the other peer
  void _tryConnect() {
    final other = _rtc.other(this);
    if (other == null) return;
    if (!(remoteSet && localSet && other.remoteSet && other.localSet)) return;
    for (final c in _localChannels.where((c) => c.twin == null)) {
      final twin = FakeChannel(c.label);
      c.twin = twin;
      twin.twin = c;
      other._remoteChannels.add(twin);
      Future.microtask(() {
        c.open();
        twin.open();
        _states.add('connected');
        other._states.add('connected');
      });
    }
  }

  @override
  Future<void> close() async {
    closed = true;
    for (final c in _localChannels) {
      await c.close();
    }
    _states.add('closed');
  }

  void dropConnection() => _states.add('failed');
}

final class FakeChannel implements RtcChannel {
  FakeChannel(this.label);

  @override
  final String label;
  FakeChannel? twin;
  final Completer<void> _opened = Completer();
  final Completer<void> _closed = Completer();
  final StreamController<Uint8List> _messages = StreamController.broadcast();
  bool _open = false;

  void open() {
    _open = true;
    if (!_opened.isCompleted) _opened.complete();
  }

  @override
  Future<void> get opened => _opened.future;

  @override
  Stream<Uint8List> get messages => _messages.stream;

  @override
  Future<void> get closed => _closed.future;

  @override
  bool get isOpen => _open;

  @override
  void send(Uint8List bytes) {
    final t = twin;
    if (_open && t != null && t._open) t._messages.add(bytes);
  }

  @override
  Future<void> close() async {
    if (!_open && !_opened.isCompleted) {
      _opened.completeError(StateError('closed'));
    }
    _open = false;
    if (!_closed.isCompleted) _closed.complete();
    await _messages.close();
    final t = twin;
    if (t != null && t._open) await t.close();
  }
}
