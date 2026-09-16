/// The game page — twin of `Pages/Play.tsx` + `render/Scene.tsx`: the scene
/// drawn by the Flutter GPU renderer, the per-platform input (captured mouse +
/// keyboard, or the touch layer), the game and session loop, and the HUD.
library;

import 'dart:async';
import 'dart:ui' as ui;

import 'package:block_survival/api/api_client.dart';
import 'package:block_survival/api/game_api.dart';
import 'package:block_survival/app/launch.dart';
import 'package:block_survival/game/game.dart';
import 'package:block_survival/game/ui_state.dart';
import 'package:block_survival/input/mouse_capture.dart';
import 'package:block_survival/input/touch_controls.dart';
import 'package:block_survival/net/client_session.dart';
import 'package:block_survival/render/chunk_renderer.dart';
import 'package:block_survival/ui/hud/hud.dart';
import 'package:block_survival/world/seed.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';

/// `--dart-define=BS_TOUCH=true` shows the touch controls on a desktop build
const bool forceTouchUi = bool.fromEnvironment('BS_TOUCH');

/// how often the host uploads the world while playing (autosave.ts)
const Duration autosaveEvery = Duration(seconds: 60);

class PlayPage extends StatefulWidget {
  const PlayPage({
    super.key,
    required this.launch,
    required this.api,
    required this.onExit,
  });

  final Launch launch;
  final GameApi api;

  /// back to the lobby; the launch is disposed by then
  final VoidCallback onExit;

  @override
  State<PlayPage> createState() => _PlayPageState();
}

class _PlayPageState extends State<PlayPage>
    with SingleTickerProviderStateMixin {
  late final Ticker _ticker;
  ChunkRenderer? _renderer;
  String? _error;
  Duration _last = Duration.zero;
  final List<double> _frameTimes = [];

  final Set<LogicalKeyboardKey> _keys = {};
  final FocusNode _focus = FocusNode();
  final MouseCapture _mouse = createMouseCapture();
  final TouchControls _touch = TouchControls();
  late final bool _touchUi;
  bool _mouseSupported = false;

  /// desktop: the pointer is not captured; touch: the ☰ button was pressed
  bool _paused = true;
  bool _togglePanel = false;
  bool _dig = false;
  bool _place = false;
  int? _selectSlot;
  Timer? _autosave;
  bool _exiting = false;

  Game get game => widget.launch.game;

  @override
  void initState() {
    super.initState();
    _touchUi =
        forceTouchUi ||
        defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS;
    ChunkRenderer.create().then(
      (r) => setState(() => _renderer = r),
      onError: (Object e) =>
          setState(() => _error = 'Renderer failed to start: $e'),
    );
    _mouse.isSupported.then((v) => setState(() => _mouseSupported = v));
    _mouse.onStateChanged.listen((s) {
      if (s == CaptureState.released && mounted && !_touchUi) {
        setState(() => _paused = true);
      }
    });
    widget.launch.client?.onStatus = _onClientStatus;
    widget.launch.host?.onLost = (reason) =>
        game.ui.setNetStatus(NetStatus.error, reason);
    if (widget.launch.role == Role.host) {
      _autosave = Timer.periodic(autosaveEvery, (_) => _autosaveTick());
    }
    _ticker = createTicker(_tick)..start();
  }

  @override
  void dispose() {
    _ticker.dispose();
    _autosave?.cancel();
    _focus.dispose();
    _mouse.dispose();
    super.dispose();
  }

  void _onClientStatus(ClientStatus st) {
    if (!mounted) return;
    switch (st) {
      case ClientStatus.hostLeft:
        game.ui.setNetStatus(NetStatus.hostLeft);
      case ClientStatus.error:
        game.ui.setNetStatus(
          NetStatus.error,
          widget.launch.client?.error ?? '',
        );
      case ClientStatus.full:
        game.ui.setNetStatus(NetStatus.error, 'The game is full');
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- loop

  void _tick(Duration elapsed) {
    final dt = _last == Duration.zero
        ? 0.0
        : (elapsed - _last).inMicroseconds / 1e6;
    _last = elapsed;
    final look = _mouse.takeDelta();
    final touch = _touch.take();
    final playing = !_paused;
    final input = FrameInput(
      look: playing ? look + touch.look : Offset.zero,
      keys: playing
          ? _keyCodes(
              touch.move,
              sprint: touch.held.contains(TouchAction.sprint),
            )
          : const {},
      jump:
          playing &&
          (_down(LogicalKeyboardKey.space) ||
              touch.taps.contains(TouchAction.jump)),
      dig: playing && (_dig || touch.taps.contains(TouchAction.dig)),
      place: playing && (_place || touch.taps.contains(TouchAction.place)),
      interact: playing && touch.taps.contains(TouchAction.interact),
      togglePanel: _togglePanel,
      selectSlot: _selectSlot,
      scoreboard: _down(LogicalKeyboardKey.tab),
    );
    _dig = false;
    _place = false;
    _togglePanel = false;
    _selectSlot = null;
    game.update(dt, input);
    widget.launch.host?.tick(dt);
    widget.launch.client?.tick(dt);
    setState(() {});
  }

  Set<String> _keyCodes(Offset stick, {bool sprint = false}) => {
    if (_down(LogicalKeyboardKey.keyW) ||
        _down(LogicalKeyboardKey.arrowUp) ||
        stick.dy > 0.3)
      'KeyW',
    if (_down(LogicalKeyboardKey.keyS) ||
        _down(LogicalKeyboardKey.arrowDown) ||
        stick.dy < -0.3)
      'KeyS',
    if (_down(LogicalKeyboardKey.keyD) ||
        _down(LogicalKeyboardKey.arrowRight) ||
        stick.dx > 0.3)
      'KeyD',
    if (_down(LogicalKeyboardKey.keyA) ||
        _down(LogicalKeyboardKey.arrowLeft) ||
        stick.dx < -0.3)
      'KeyA',
    if (_down(LogicalKeyboardKey.shiftLeft) || sprint) 'ShiftLeft',
    if (_down(LogicalKeyboardKey.space)) 'Space',
  };

  bool _down(LogicalKeyboardKey key) => _keys.contains(key);

  // ---------------------------------------------------------------- input

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    final key = event.logicalKey;
    if (event is KeyDownEvent) {
      _keys.add(key);
      if (key == LogicalKeyboardKey.escape) {
        if (game.panel != Panel.none) {
          game.closePanel();
        } else {
          _pause();
        }
      } else if (key == LogicalKeyboardKey.keyE) {
        _togglePanel = true;
      } else if (key == LogicalKeyboardKey.keyF) {
        if (game.target()?.block == 16) _togglePanel = true; // workbench
      } else {
        final digit = key.keyId - LogicalKeyboardKey.digit1.keyId;
        if (digit >= 0 && digit < 9) _selectSlot = digit;
      }
    }
    if (event is KeyUpEvent) _keys.remove(key);
    return KeyEventResult.handled;
  }

  void _onMouseDown(PointerDownEvent e) {
    if (_touchUi || e.kind != PointerDeviceKind.mouse) return;
    _focus.requestFocus();
    if (_paused) return; // the overlay's tap resumes
    if (e.buttons & kSecondaryMouseButton != 0) {
      _place = true;
    } else if (e.buttons & kPrimaryMouseButton != 0) {
      _dig = true;
    }
  }

  /// drag-to-look where the pointer cannot be captured
  void _onDrag(DragUpdateDetails d) {
    if (!_paused && _mouse.state != CaptureState.captured) {
      _mouse.addDelta(d.delta);
    }
  }

  void _resume() {
    _focus.requestFocus();
    setState(() => _paused = false);
    if (!_touchUi && _mouseSupported) _mouse.capture();
    if (!_mouseSupported) {
      _mouse.capture(); // the drag fallback needs the captured state
    }
  }

  void _pause() {
    setState(() => _paused = true);
    _mouse.release();
  }

  // ---------------------------------------------------------------- saves and leaving

  Future<String> _saveWorld() async {
    try {
      final save = game.buildSave();
      await widget.api.saveWorld(
        save.toJson(),
        night: game.dayNight.night,
        seconds: game.dayNight.time.floor(),
        kind: widget.launch.worldKind,
      );
      game.needsSave = false;
      return 'Saved';
    } on ApiError catch (e) {
      return e.message;
    } on Object {
      return 'Save failed';
    }
  }

  Future<void> _autosaveTick() async {
    if (game.needsSave && widget.launch.role == Role.host) await _saveWorld();
  }

  /// back to the lobby: the host's world is uploaded first when anything
  /// changed; a seat in the global world is given up
  Future<void> _leave() async {
    if (_exiting) return;
    _exiting = true;
    _mouse.release();
    if (widget.launch.role == Role.host && game.needsSave) await _saveWorld();
    if (widget.launch.worldKind == WorldKind.global &&
        widget.launch.role == Role.client) {
      unawaited(widget.api.leaveGlobal().catchError((Object _) {}));
    }
    await widget.launch.dispose();
    if (mounted) widget.onExit();
  }

  // ---------------------------------------------------------------- build

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Scaffold(
        body: Center(child: Text(_error!, textAlign: TextAlign.center)),
      );
    }
    return Scaffold(
      body: Focus(
        focusNode: _focus,
        autofocus: true,
        onKeyEvent: _onKey,
        child: Listener(
          onPointerDown: _onMouseDown,
          child: GestureDetector(
            onPanUpdate: _touchUi ? null : _onDrag,
            child: Stack(
              fit: StackFit.expand,
              children: [
                LayoutBuilder(
                  builder: (context, constraints) {
                    final dpr = MediaQuery.devicePixelRatioOf(context);
                    return CustomPaint(
                      painter: _ScenePainter(
                        this,
                        (constraints.maxWidth * dpr).round(),
                        (constraints.maxHeight * dpr).round(),
                      ),
                      size: Size.infinite,
                    );
                  },
                ),
                if (_touchUi && !_paused && game.panel == Panel.none)
                  Positioned.fill(
                    child: TouchControlsLayer(
                      controls: _touch,
                      onPause: _pause,
                    ),
                  ),
                HudLayer(
                  launch: widget.launch,
                  api: widget.api,
                  paused: _paused,
                  touch: _touchUi,
                  actions: HudActions(
                    resume: _resume,
                    leave: _leave,
                    saveWorld: widget.launch.role == Role.host
                        ? _saveWorld
                        : null,
                    closePanel: () => setState(game.closePanel),
                  ),
                ),
                if (kDebugMode)
                  Positioned(
                    left: 18,
                    top: 110,
                    child: IgnorePointer(
                      child: _FrameStats(_frameTimes, _renderer),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// called from the painter, so the GPU work happens inside the frame
  ui.Image? renderFrame(int width, int height) {
    final renderer = _renderer;
    if (renderer == null || width == 0 || height == 0) return null;
    final sw = Stopwatch()..start();
    renderer.sync(game.world);
    final (image, _) = renderer.render(
      game.camera,
      game.lighting(),
      width,
      height,
    );
    sw.stop();
    _frameTimes.add(sw.elapsedMicroseconds / 1000);
    if (_frameTimes.length > 120) _frameTimes.removeAt(0);
    return image;
  }
}

class _ScenePainter extends CustomPainter {
  _ScenePainter(this.state, this.width, this.height);

  final _PlayPageState state;
  final int width;
  final int height;

  @override
  void paint(Canvas canvas, Size size) {
    final image = state.renderFrame(width, height);
    if (image == null) return;
    canvas.drawImageRect(
      image,
      Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()),
      Rect.fromLTWH(0, 0, size.width, size.height),
      Paint(),
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}

class _FrameStats extends StatelessWidget {
  const _FrameStats(this.times, this.renderer);

  final List<double> times;
  final ChunkRenderer? renderer;

  @override
  Widget build(BuildContext context) {
    final avg = times.isEmpty
        ? 0.0
        : times.reduce((a, b) => a + b) / times.length;
    return Text(
      'render ${avg.toStringAsFixed(2)} ms · ${renderer?.chunkCount ?? 0} chunks',
      style: const TextStyle(
        fontSize: 11,
        color: Colors.white60,
        fontFamily: 'monospace',
      ),
    );
  }
}
