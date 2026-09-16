/// A peer's mailbox in one room — twin of `Signaller` in
/// `server/resources/js/net/transport.ts`. Offers, answers and ICE candidates
/// go through `POST /api/rooms/{code}/signal` and each peer polls
/// `GET /api/rooms/{code}/signals` for the ones addressed to it: no socket
/// server, so it runs on shared hosting. Sends go straight to the API; receives
/// come from a polling loop that advances an id cursor so nothing is delivered
/// twice. Delivery order is the server's insertion order, so an offer always
/// precedes its candidates.
library;

import 'dart:async';
import 'dart:math' as math;

import 'package:block_survival/api/api_client.dart';
import 'package:block_survival/api/game_api.dart';
import 'package:block_survival/api/models.dart';

/// poll cadence: quick while a handshake is in flight, relaxed once the room is quiet
const Duration pollActive = Duration(milliseconds: 500);
const Duration pollIdle = Duration(milliseconds: 1500);

/// how long after the last signal the poller stays on the quick cadence
const Duration pollActiveWindow = Duration(seconds: 10);

/// a failed poll backs off this much more each time (capped)
const Duration _pollErrorStep = Duration(seconds: 1);
const Duration _pollErrorMax = Duration(seconds: 5);

/// the server's page size; a full page means more is probably waiting
const int _pollPage = 50;

/// a send that fails on the network or with a 5xx is retried this many more times
const int _sendRetries = 2;
const Duration _sendRetryDelay = Duration(milliseconds: 300);

const String _idAlphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

String makePeerId([math.Random? random]) {
  final r = random ?? math.Random.secure();
  return List.generate(
    16,
    (_) => _idAlphabet[r.nextInt(256) % _idAlphabet.length],
  ).join();
}

final class SignalMessage {
  const SignalMessage({
    required this.from,
    required this.to,
    required this.type,
    required this.data,
  });

  final String from;
  final String to;

  /// offer | answer | candidate
  final String type;
  final Map<String, dynamic> data;
}

/// the room the joiner polled is gone (404); a connect timeout reports this
final class RoomGone implements Exception {
  const RoomGone();

  @override
  String toString() => 'The game is no longer open.';
}

typedef Clock = DateTime Function();
typedef Sleeper = Future<void> Function(Duration);

final class Signaller {
  Signaller(
    this._api,
    this.code,
    this.me, {
    this.alwaysActive = false,
    Clock? now,
    Sleeper? sleep,
  }) : _now = now ?? DateTime.now,
       _sleep = sleep ?? ((d) => Future<void>.delayed(d));

  final GameApiSignals _api;
  final String code;
  final String me;

  /// true = always poll at the active cadence (a joining client, which stops as soon as it connects)
  final bool alwaysActive;
  final Clock _now;
  final Sleeper _sleep;

  final StreamController<SignalMessage> _messages =
      StreamController.broadcast();
  int _cursor = 0;
  Timer? _timer;
  bool _inFlight = false;
  bool _stopped = false;
  DateTime? _lastSignalAt;
  Duration _errorBackoff = Duration.zero;

  /// set when the last poll found no live room
  RoomGone? gone;

  Stream<SignalMessage> get messages => _messages.stream;
  int get cursor => _cursor;

  /// Post one message to `to`; a lost offer or answer is a failed join, so
  /// transient errors are retried.
  Future<void> send(String to, String type, Map<String, dynamic> data) async {
    for (var attempt = 0; ; attempt++) {
      try {
        await _api.signal(code, from: me, to: to, type: type, data: data);
        return;
      } on ApiError catch (e) {
        final transient = e.status == 0 || e.status >= 500;
        if (!transient || attempt >= _sendRetries) rethrow;
        await _sleep(_sendRetryDelay * (attempt + 1));
      }
    }
  }

  /// Begin polling. The first poll is immediate; later ones follow the cadence.
  void start() {
    if (_stopped || _timer != null || _inFlight) return;
    _schedule(Duration.zero);
  }

  /// Stop polling; a poll already in flight is dropped when it lands.
  void leave() {
    _stopped = true;
    _timer?.cancel();
    _timer = null;
    _messages.close();
  }

  Duration _delay() {
    if (_errorBackoff > Duration.zero) return _errorBackoff;
    if (alwaysActive) return pollActive;
    final last = _lastSignalAt;
    return last != null && _now().difference(last) < pollActiveWindow
        ? pollActive
        : pollIdle;
  }

  void _schedule(Duration d) {
    if (_stopped) return;
    _timer = Timer(d, () {
      _timer = null;
      unawaited(_poll());
    });
  }

  Future<void> _poll() async {
    if (_stopped || _inFlight) return;
    _inFlight = true;
    var rows = const <SignalRow>[];
    try {
      rows = await _api.signals(code, to: me, after: _cursor);
      _errorBackoff = Duration.zero;
      gone = null;
    } on ApiError catch (e) {
      gone = e.status == 404 ? const RoomGone() : null;
      final next = _errorBackoff + _pollErrorStep;
      _errorBackoff = next > _pollErrorMax ? _pollErrorMax : next;
    } finally {
      _inFlight = false;
    }
    if (_stopped) return;
    if (rows.isNotEmpty) _lastSignalAt = _now();
    for (final r in rows) {
      _cursor = math.max(_cursor, r.id);
      _messages.add(
        SignalMessage(from: r.from, to: me, type: r.type, data: r.data),
      );
    }
    _schedule(rows.length >= _pollPage ? Duration.zero : _delay());
  }
}
