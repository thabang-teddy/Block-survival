/// The slice of WebRTC the transport needs, as an interface so the handshake
/// logic is unit-tested with in-memory peers and only `FlutterWebRtc` (in
/// rtc_flutter.dart) touches the plugin.
library;

import 'dart:async';
import 'dart:typed_data';

/// STUN servers, as the browser client's RTC_CONFIG
const List<String> stunServers = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
];

/// `{type, sdp}` for descriptions, `{candidate, sdpMid, sdpMLineIndex}` for candidates
typedef SignalData = Map<String, dynamic>;

abstract interface class RtcChannel {
  String get label;

  /// completes when the channel opens; errors if it closes first
  Future<void> get opened;
  Stream<Uint8List> get messages;
  Future<void> get closed;
  bool get isOpen;
  void send(Uint8List bytes);
  Future<void> close();
}

abstract interface class RtcPeer {
  /// ICE candidates gathered locally, to forward to the remote peer
  Stream<SignalData> get localCandidates;

  /// channels the remote side created (the host receives the client's)
  Stream<RtcChannel> get remoteChannels;

  /// connected | disconnected | failed | closed (the states the transport acts on)
  Stream<String> get connectionState;

  Future<RtcChannel> createDataChannel(String label);
  Future<SignalData> createOffer();
  Future<SignalData> createAnswer();
  Future<void> setRemoteDescription(SignalData description);
  Future<void> addIceCandidate(SignalData candidate);
  Future<void> close();
}

abstract interface class RtcFactory {
  Future<RtcPeer> createPeer();
}
