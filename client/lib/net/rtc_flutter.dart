/// The `RtcFactory` backed by package:flutter_webrtc (Android, Windows, Linux).
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:block_survival/net/rtc.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart' as webrtc;

final class FlutterWebRtc implements RtcFactory {
  const FlutterWebRtc({this.iceServers = stunServers});

  final List<String> iceServers;

  @override
  Future<RtcPeer> createPeer() async {
    final pc = await webrtc.createPeerConnection({
      'iceServers': [
        {'urls': iceServers},
      ],
      // the browser client negotiates data channels only
      'sdpSemantics': 'unified-plan',
    });
    return _FlutterPeer(pc);
  }
}

final class _FlutterPeer implements RtcPeer {
  _FlutterPeer(this._pc) {
    _pc.onIceCandidate = (c) {
      if (c.candidate == null || _candidates.isClosed) return;
      _candidates.add({
        'candidate': c.candidate,
        'sdpMid': c.sdpMid,
        'sdpMLineIndex': c.sdpMLineIndex,
      });
    };
    _pc.onDataChannel = (dc) {
      if (!_channels.isClosed) _channels.add(_FlutterChannel(dc));
    };
    _pc.onConnectionState = (s) {
      if (!_states.isClosed) _states.add(_stateName(s));
    };
  }

  final webrtc.RTCPeerConnection _pc;
  final StreamController<SignalData> _candidates = StreamController.broadcast();
  final StreamController<RtcChannel> _channels = StreamController.broadcast();
  final StreamController<String> _states = StreamController.broadcast();

  static String _stateName(webrtc.RTCPeerConnectionState s) => switch (s) {
    webrtc.RTCPeerConnectionState.RTCPeerConnectionStateConnected =>
      'connected',
    webrtc.RTCPeerConnectionState.RTCPeerConnectionStateDisconnected =>
      'disconnected',
    webrtc.RTCPeerConnectionState.RTCPeerConnectionStateFailed => 'failed',
    webrtc.RTCPeerConnectionState.RTCPeerConnectionStateClosed => 'closed',
    webrtc.RTCPeerConnectionState.RTCPeerConnectionStateConnecting =>
      'connecting',
    webrtc.RTCPeerConnectionState.RTCPeerConnectionStateNew => 'new',
  };

  @override
  Stream<SignalData> get localCandidates => _candidates.stream;

  @override
  Stream<RtcChannel> get remoteChannels => _channels.stream;

  @override
  Stream<String> get connectionState => _states.stream;

  @override
  Future<RtcChannel> createDataChannel(String label) async {
    final dc = await _pc.createDataChannel(
      label,
      webrtc.RTCDataChannelInit()..ordered = true,
    );
    return _FlutterChannel(dc);
  }

  @override
  Future<SignalData> createOffer() async {
    final offer = await _pc.createOffer({});
    await _pc.setLocalDescription(offer);
    return {'type': offer.type, 'sdp': offer.sdp};
  }

  @override
  Future<SignalData> createAnswer() async {
    final answer = await _pc.createAnswer({});
    await _pc.setLocalDescription(answer);
    return {'type': answer.type, 'sdp': answer.sdp};
  }

  @override
  Future<void> setRemoteDescription(SignalData description) =>
      _pc.setRemoteDescription(
        webrtc.RTCSessionDescription(
          description['sdp'] as String?,
          description['type'] as String?,
        ),
      );

  @override
  Future<void> addIceCandidate(SignalData candidate) => _pc.addCandidate(
    webrtc.RTCIceCandidate(
      candidate['candidate'] as String?,
      candidate['sdpMid'] as String?,
      (candidate['sdpMLineIndex'] as num?)?.toInt(),
    ),
  );

  @override
  Future<void> close() async {
    // the plugin may still deliver a callback after close(); detach first
    _pc.onIceCandidate = null;
    _pc.onDataChannel = null;
    _pc.onConnectionState = null;
    await _candidates.close();
    await _channels.close();
    await _states.close();
    await _pc.close();
  }
}

final class _FlutterChannel implements RtcChannel {
  _FlutterChannel(this._dc) {
    if (_dc.state == webrtc.RTCDataChannelState.RTCDataChannelOpen) {
      _opened.complete();
    }
    _dc.onDataChannelState = (s) {
      switch (s) {
        case webrtc.RTCDataChannelState.RTCDataChannelOpen:
          if (!_opened.isCompleted) _opened.complete();
        case webrtc.RTCDataChannelState.RTCDataChannelClosed:
          if (!_opened.isCompleted) {
            _opened.completeError(StateError('channel closed before opening'));
          }
          if (!_closed.isCompleted) _closed.complete();
          if (!_messages.isClosed) _messages.close();
        default:
          break;
      }
    };
    _dc.onMessage = (m) {
      if (m.isBinary && !_messages.isClosed) _messages.add(m.binary);
    };
  }

  final webrtc.RTCDataChannel _dc;
  final Completer<void> _opened = Completer();
  final Completer<void> _closed = Completer();
  final StreamController<Uint8List> _messages = StreamController.broadcast();

  @override
  String get label => _dc.label ?? '';

  @override
  Future<void> get opened => _opened.future;

  @override
  Stream<Uint8List> get messages => _messages.stream;

  @override
  Future<void> get closed => _closed.future;

  @override
  bool get isOpen => _dc.state == webrtc.RTCDataChannelState.RTCDataChannelOpen;

  @override
  void send(Uint8List bytes) =>
      unawaited(_dc.send(webrtc.RTCDataChannelMessage.fromBinary(bytes)));

  @override
  Future<void> close() async {
    _dc.onMessage = null;
    await _dc.close();
    if (!_closed.isCompleted) _closed.complete();
    if (!_messages.isClosed) await _messages.close();
  }
}
