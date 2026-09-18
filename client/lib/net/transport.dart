/// WebRTC transport with signalling over the rooms API — twin of
/// `HostTransport` / `ClientTransport` in `server/resources/js/net/transport.ts`.
/// Once the handshake completes all traffic is peer-to-peer over a reliable,
/// ordered DataChannel carrying MessagePack bytes.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:block_survival/api/game_api.dart';
import 'package:block_survival/net/rtc.dart';
import 'package:block_survival/net/signaller.dart';

const Duration connectTimeout = Duration(seconds: 15);
const String _dataChannel = 'game';

/// one connected peer
final class Link {
  Link._(this.id, this._channel, this._peer);

  final String id;
  final RtcChannel _channel;
  final RtcPeer _peer;

  void send(Uint8List bytes) {
    if (_channel.isOpen) _channel.send(bytes);
  }

  Future<void> close() async {
    await _channel.close();
    await _peer.close();
  }
}

abstract interface class TransportEvents {
  void onOpen(Link link);
  void onData(Link link, Uint8List bytes);
  void onClose(Link link);
}

/// One peer connection: candidates are queued until the remote description is set.
final class _Peer {
  _Peer(this.pc, this.remoteId, Signaller signaller) {
    _candidateSub = pc.localCandidates.listen(
      (c) => unawaited(
        signaller.send(remoteId, 'candidate', c).catchError((Object _) {}),
      ),
    );
  }

  final RtcPeer pc;
  final String remoteId;
  final List<SignalData> _pending = [];
  bool _remoteSet = false;
  late final StreamSubscription<SignalData> _candidateSub;

  Future<void> setRemote(SignalData desc) async {
    await pc.setRemoteDescription(desc);
    _remoteSet = true;
    for (final c in _pending) {
      try {
        await pc.addIceCandidate(c);
      } on Object {
        // a stale candidate is harmless
      }
    }
    _pending.clear();
  }

  Future<void> addCandidate(SignalData c) async {
    if (!_remoteSet) {
      _pending.add(c);
      return;
    }
    try {
      await pc.addIceCandidate(c);
    } on Object {
      // ignore
    }
  }

  Future<void> close() async {
    // not awaited: a broadcast cancel has nothing to wait for, and under a
    // fake async zone its pre-built future never resolves
    unawaited(_candidateSub.cancel());
    await pc.close();
  }
}

/// Wire a channel to the events; `onClose` fires once, on channel or connection loss.
Link _wrap(
  _Peer peer,
  RtcChannel dc,
  void Function(Link, Uint8List) onData,
  void Function(Link) onClose,
) {
  final link = Link._(peer.remoteId, dc, peer.pc);
  var closed = false;
  void close() {
    if (closed) return;
    closed = true;
    onClose(link);
  }

  dc.messages.listen((bytes) => onData(link, bytes), onDone: close);
  unawaited(dc.closed.then((_) => close()));
  peer.pc.connectionState.listen((s) {
    if (s == 'failed' || s == 'closed' || s == 'disconnected') close();
  });
  return link;
}

final class HostTransport {
  HostTransport(this._api, this._rtc, this._events, {String? id})
    : id = id ?? makePeerId();

  final GameApiSignals _api;
  final RtcFactory _rtc;
  final TransportEvents _events;
  final String id;
  final Map<String, Link> links = {};
  final Map<String, _Peer> _peers = {};
  Signaller? _signaller;

  /// Open the room's mailbox and answer every offer that names us.
  void listen(String code) {
    final s = Signaller(_api, code, id);
    _signaller = s;
    s.messages.listen((m) => unawaited(_onSignal(s, m)));
    s.start();
  }

  Future<void> _onSignal(Signaller s, SignalMessage m) async {
    var peer = _peers[m.from];
    if (m.type == 'offer') {
      await peer?.close();
      final pc = await _rtc.createPeer();
      final fresh = _Peer(pc, m.from, s);
      peer = fresh;
      _peers[m.from] = fresh;
      pc.remoteChannels.listen((channel) {
        final link = _wrap(fresh, channel, _events.onData, (l) {
          links.remove(l.id);
          _peers.remove(l.id);
          _events.onClose(l);
        });
        unawaited(
          channel.opened
              .then((_) {
                links[link.id] = link;
                _events.onOpen(link);
              })
              .catchError((Object _) {
                // closed before it opened: _wrap's onClose already handled it
              }),
        );
      });
      try {
        await fresh.setRemote(m.data);
        final answer = await pc.createAnswer();
        await s.send(m.from, 'answer', answer);
      } on Object {
        // a lost answer is a failed join for that client: drop the half-open peer
        if (_peers[m.from] == fresh) _peers.remove(m.from);
        await fresh.close();
      }
    } else if (m.type == 'candidate' && peer != null) {
      await peer.addCandidate(m.data);
    }
  }

  void broadcast(Uint8List bytes) {
    for (final l in links.values) {
      l.send(bytes);
    }
  }

  Future<void> dispose() async {
    for (final l in links.values.toList()) {
      await l.close();
    }
    links.clear();
    for (final p in _peers.values.toList()) {
      await p.close();
    }
    _peers.clear();
    _signaller?.leave();
    _signaller = null;
  }
}

final class ClientTransport {
  ClientTransport(this._api, this._rtc, this._events, {String? id})
    : id = id ?? makePeerId();

  final GameApiSignals _api;
  final RtcFactory _rtc;
  final TransportEvents _events;
  final String id;
  Link? link;
  Signaller? _signaller;
  _Peer? _peer;

  /// Resolve the host through the rooms API, then offer it a DataChannel.
  Future<Link> connect(String code, {Duration timeout = connectTimeout}) async {
    final room = await _api.resolveRoom(code);
    final s = Signaller(_api, code, id, alwaysActive: true);
    _signaller = s;
    final pc = await _rtc.createPeer();
    final peer = _Peer(pc, room.hostPeerId, s);
    _peer = peer;
    final dc = await pc.createDataChannel(_dataChannel);

    final done = Completer<Link>();
    // one exit for every way the handshake can fail
    void fail(Object error) {
      if (done.isCompleted) return;
      unawaited(peer.close());
      s.leave();
      _peer = null;
      _signaller = null;
      done.completeError(error);
    }

    final timer = Timer(timeout, () {
      fail(
        s.gone ??
            StateError('Could not reach the host (is the game still open?)'),
      );
    });
    final wrapped = _wrap(peer, dc, _events.onData, (l) {
      link = null;
      _events.onClose(l);
    });
    unawaited(
      dc.opened
          .then((_) {
            if (done.isCompleted) return;
            timer.cancel();
            // connected: the mailbox has done its job, stop polling
            s.leave();
            link = wrapped;
            _events.onOpen(wrapped);
            done.complete(wrapped);
          })
          .catchError((Object _) {
            // the channel closed before opening: the timeout or fail() reports it
          }),
    );
    s.messages.listen((m) {
      final f = switch (m.type) {
        'answer' => peer.setRemote(m.data),
        'candidate' => peer.addCandidate(m.data),
        _ => Future<void>.value(),
      };
      unawaited(f.catchError((Object _) {}));
    });
    s.start();
    try {
      final offer = await pc.createOffer();
      await s.send(room.hostPeerId, 'offer', offer);
    } on Object catch (e) {
      timer.cancel();
      fail(e);
    }
    return done.future;
  }

  Future<void> dispose() async {
    await link?.close();
    link = null;
    await _peer?.close();
    _peer = null;
    _signaller?.leave();
    _signaller = null;
  }
}
