/// Relative mouse motion with a hidden cursor — the desktop half of spike S3.
///
/// Flutter has no pointer lock, so each desktop runner implements the
/// `block_survival/mouse` method channel (windows/runner/mouse_capture.cpp;
/// the Linux runner answers `isSupported: false` until its GDK/XI2 backend is
/// written). Where it is unsupported the game falls back to drag-to-look.
///
/// Deltas are pulled, not pushed: the game loop asks "how far did the mouse
/// move since the last step" once per step with [takeDelta].
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

enum CaptureState { released, captured }

abstract interface class MouseCapture {
  /// false on touch platforms and on runners without a backend
  Future<bool> get isSupported;
  CaptureState get state;
  Stream<CaptureState> get onStateChanged;

  Future<bool> capture();
  Future<void> release();

  /// accumulated motion in mouse counts since the last call; zero when released
  Offset takeDelta();

  /// the drag fallback feeds motion in here
  void addDelta(Offset delta);

  void dispose();
}

/// the runner-backed implementation (Windows today)
final class ChannelMouseCapture implements MouseCapture {
  ChannelMouseCapture([MethodChannel? channel])
    : _channel = channel ?? const MethodChannel(_channelName) {
    _channel.setMethodCallHandler(_fromRunner);
  }

  static const _channelName = 'block_survival/mouse';

  final MethodChannel _channel;
  final StreamController<CaptureState> _states = StreamController.broadcast();
  CaptureState _state = CaptureState.released;
  double _dx = 0;
  double _dy = 0;
  bool? _supported;

  @override
  Future<bool> get isSupported async {
    if (_supported != null) return _supported!;
    try {
      _supported = await _channel.invokeMethod<bool>('isSupported') ?? false;
    } on MissingPluginException {
      _supported = false;
    } on PlatformException {
      _supported = false;
    }
    return _supported!;
  }

  @override
  CaptureState get state => _state;

  @override
  Stream<CaptureState> get onStateChanged => _states.stream;

  @override
  Future<bool> capture() async {
    if (!await isSupported) return false;
    final ok = await _channel.invokeMethod<bool>('capture') ?? false;
    if (ok) _set(CaptureState.captured);
    return ok;
  }

  @override
  Future<void> release() async {
    if (_state == CaptureState.released) return;
    _set(CaptureState.released);
    if (await isSupported) await _channel.invokeMethod<void>('release');
  }

  @override
  Offset takeDelta() {
    final d = Offset(_dx, _dy);
    _dx = 0;
    _dy = 0;
    return d;
  }

  @override
  void addDelta(Offset delta) {
    _dx += delta.dx;
    _dy += delta.dy;
  }

  Future<dynamic> _fromRunner(MethodCall call) async {
    switch (call.method) {
      case 'delta':
        final args = (call.arguments as List).cast<num>();
        if (_state == CaptureState.captured) {
          _dx += args[0];
          _dy += args[1];
        }
      case 'released':
        // focus was lost: the runner already freed the cursor
        _set(CaptureState.released);
        _dx = 0;
        _dy = 0;
    }
    return null;
  }

  void _set(CaptureState s) {
    if (s == _state) return;
    _state = s;
    _states.add(s);
  }

  @override
  void dispose() {
    _channel.setMethodCallHandler(null);
    _states.close();
  }
}

/// touch platforms and runners without pointer lock: motion arrives via [addDelta]
final class DragMouseCapture implements MouseCapture {
  final StreamController<CaptureState> _states = StreamController.broadcast();
  CaptureState _state = CaptureState.released;
  double _dx = 0;
  double _dy = 0;

  @override
  Future<bool> get isSupported async => false;

  @override
  CaptureState get state => _state;

  @override
  Stream<CaptureState> get onStateChanged => _states.stream;

  @override
  Future<bool> capture() async {
    _state = CaptureState.captured;
    _states.add(_state);
    return true;
  }

  @override
  Future<void> release() async {
    _state = CaptureState.released;
    _states.add(_state);
  }

  @override
  Offset takeDelta() {
    final d = Offset(_dx, _dy);
    _dx = 0;
    _dy = 0;
    return d;
  }

  @override
  void addDelta(Offset delta) {
    _dx += delta.dx;
    _dy += delta.dy;
  }

  @override
  void dispose() => _states.close();
}

/// the right implementation for this platform
MouseCapture createMouseCapture() {
  if (kIsWeb) return DragMouseCapture();
  return switch (defaultTargetPlatform) {
    TargetPlatform.windows ||
    TargetPlatform.linux ||
    TargetPlatform.macOS => ChannelMouseCapture(),
    _ => DragMouseCapture(),
  };
}
