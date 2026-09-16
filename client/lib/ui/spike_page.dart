/// S1 spike: stream the real world around the spawn pad, mesh it, and draw it
/// with the Flutter GPU renderer while a first-person camera moves. Shows
/// frame time so the go/no-go in docs/flutter-client-plan.md can be measured.
///
/// Input (spike S3): click to capture the mouse on desktop, Esc releases;
/// drag-to-look where capture is unsupported; joystick + look-drag on touch.
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:block_survival/input/mouse_capture.dart';
import 'package:block_survival/input/touch_controls.dart';
import 'package:block_survival/physics/player_controller.dart';
import 'package:block_survival/render/camera.dart';
import 'package:block_survival/render/chunk_renderer.dart';
import 'package:block_survival/render/lighting.dart';
import 'package:block_survival/world/seed.dart';
import 'package:block_survival/world/terrain_gen.dart';
import 'package:block_survival/world/world.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';
import 'package:vector_math/vector_math_64.dart' as vm;

/// chunk columns loaded around the camera for the spike (radius, in chunks)
const int spikeRadius = 4;

class SpikePage extends StatefulWidget {
  const SpikePage({super.key, this.seed = globalSeed});

  final int seed;

  @override
  State<SpikePage> createState() => _SpikePageState();
}

class _SpikePageState extends State<SpikePage>
    with SingleTickerProviderStateMixin {
  late final Ticker _ticker;
  late final World _world;
  late final TerrainGenerator _generator;
  late final Camera _camera;
  late final PlayerController _player;
  double _accumulator = 0;
  static const double _fixedDt = 1 / 60;
  ChunkRenderer? _renderer;
  String? _error;

  RenderStats _stats = const RenderStats(chunks: 0, drawCalls: 0, triangles: 0);
  final List<double> _frameTimes = [];
  Duration _last = Duration.zero;
  double _phase = 0;
  int _meshMs = 0;
  int _loadedAround = -1;

  final Set<LogicalKeyboardKey> _keys = {};
  final FocusNode _focus = FocusNode();
  final MouseCapture _mouse = createMouseCapture();
  final TouchControls _touch = TouchControls();
  bool _touchUi = false;
  bool _mouseSupported = false;

  @override
  void initState() {
    super.initState();
    _generator = TerrainGenerator(widget.seed);
    _world = World()
      ..setGenerator(_generator.generateChunk, worldChunksY)
      ..trackEdits = true;
    final spawn = _generator.spawn();
    _player = PlayerController(_world, spawn.x, spawn.y, spawn.z)
      ..updrafts = (x, z) =>
          _generator.updraftsNear(x - 3, z - 3, x + 3, z + 3);
    _camera = Camera(
      position: vm.Vector3(spawn.x, spawn.y + PlayerTuning.eyeHeight, spawn.z),
    );
    ChunkRenderer.create().then(
      (r) => setState(() => _renderer = r),
      onError: (Object e) =>
          setState(() => _error = 'Renderer failed to start: $e'),
    );
    _mouse.isSupported.then((v) => setState(() => _mouseSupported = v));
    _touchUi =
        defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS;
    _streamAround();
    _ticker = createTicker(_tick)..start();
  }

  @override
  void dispose() {
    _ticker.dispose();
    _focus.dispose();
    _mouse.dispose();
    super.dispose();
  }

  /// load the columns around the camera; unload the ones that fell out of range
  void _streamAround() {
    final ccx = (_camera.position.x / 16).floor();
    final ccz = (_camera.position.z / 16).floor();
    final key = ccx * 100000 + ccz;
    if (key == _loadedAround) return;
    _loadedAround = key;
    final wanted = <(int, int)>{};
    for (var dx = -spikeRadius; dx <= spikeRadius; dx++) {
      for (var dz = -spikeRadius; dz <= spikeRadius; dz++) {
        if (dx * dx + dz * dz <= spikeRadius * spikeRadius + 1) {
          wanted.add((ccx + dx, ccz + dz));
        }
      }
    }
    for (final (cx, cz) in _loaded.difference(wanted)) {
      _world.unloadColumn(cx, cz);
    }
    for (final (cx, cz) in wanted.difference(_loaded)) {
      _world.loadColumn(cx, cz);
    }
    _loaded
      ..clear()
      ..addAll(wanted);
  }

  final Set<(int, int)> _loaded = {};

  void _tick(Duration elapsed) {
    final dt = _last == Duration.zero
        ? 0.0
        : (elapsed - _last).inMicroseconds / 1e6;
    _last = elapsed;
    final look = _mouse.takeDelta();
    final touch = _touch.take();
    // the controller has its own sensitivity (PlayerTuning.mouseSensitivity)
    _player.look(look.dx + touch.look.dx, look.dy + touch.look.dy);
    if (_down(LogicalKeyboardKey.space)) _player.queueJump();
    // fixed 60 Hz steps, as the browser client
    _accumulator += dt > 0.25 ? 0.25 : dt;
    final input = KeySetInput(_keyCodes(touch.move));
    while (_accumulator >= _fixedDt) {
      _player.update(_fixedDt, input);
      _accumulator -= _fixedDt;
    }
    final s = _player.state;
    _camera
      ..position = vm.Vector3(s.x, s.y + PlayerTuning.eyeHeight, s.z)
      ..yaw = s.yaw
      ..pitch = s.pitch;
    _streamAround();
    _phase = (_phase + dt / 120) % 1.0; // a two-minute day for the demo
    setState(() {});
  }

  /// browser KeyboardEvent.code names for the held keys; the touch stick maps
  /// to the four directions above a dead zone (analog movement is a P4 item)
  Set<String> _keyCodes(Offset stick) => {
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
    if (_down(LogicalKeyboardKey.shiftLeft)) 'ShiftLeft',
    if (_down(LogicalKeyboardKey.space)) 'Space',
  };

  bool _down(LogicalKeyboardKey key) => _keys.contains(key);

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is KeyDownEvent &&
        event.logicalKey == LogicalKeyboardKey.escape) {
      _mouse.release();
    }
    if (event is KeyDownEvent) _keys.add(event.logicalKey);
    if (event is KeyUpEvent) _keys.remove(event.logicalKey);
    return KeyEventResult.handled;
  }

  /// drag-to-look where the pointer cannot be captured
  void _onDrag(DragUpdateDetails d) {
    if (_mouse.state != CaptureState.captured) _mouse.addDelta(d.delta);
  }

  void _onTap() {
    _focus.requestFocus();
    if (_mouseSupported) _mouse.capture();
  }

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
        child: GestureDetector(
          onPanUpdate: _touchUi ? null : _onDrag,
          onTap: _touchUi ? null : _onTap,
          child: Stack(
            fit: StackFit.expand,
            children: [
              LayoutBuilder(
                builder: (context, constraints) {
                  final dpr = MediaQuery.devicePixelRatioOf(context);
                  final w = (constraints.maxWidth * dpr).round();
                  final h = (constraints.maxHeight * dpr).round();
                  return CustomPaint(
                    painter: _FramePainter(this, w, h),
                    size: Size.infinite,
                  );
                },
              ),
              if (_touchUi)
                Positioned.fill(child: TouchControlsLayer(controls: _touch)),
              Positioned(left: 12, top: 12, child: _Hud(this)),
            ],
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
    renderer.sync(_world);
    final meshMs = sw.elapsedMilliseconds;
    final (image, stats) = renderer.render(
      _camera,
      Lighting.at(_phase),
      width,
      height,
    );
    sw.stop();

    _stats = stats;
    _meshMs = meshMs;
    _frameTimes.add(sw.elapsedMicroseconds / 1000);
    if (_frameTimes.length > 120) _frameTimes.removeAt(0);
    return image;
  }
}

class _FramePainter extends CustomPainter {
  _FramePainter(this.state, this.width, this.height);

  final _SpikePageState state;
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

class _Hud extends StatelessWidget {
  const _Hud(this.state);

  final _SpikePageState state;

  @override
  Widget build(BuildContext context) {
    final times = state._frameTimes;
    final sorted = List<double>.of(times)..sort();
    final p95 = sorted.isEmpty
        ? 0.0
        : sorted[math.min(sorted.length - 1, (sorted.length * 0.95).floor())];
    final avg = times.isEmpty
        ? 0.0
        : times.reduce((a, b) => a + b) / times.length;
    final s = state._stats;
    final c = state._camera;
    return DefaultTextStyle(
      style: const TextStyle(
        color: Colors.white,
        fontSize: 13,
        fontFamily: 'monospace',
        shadows: [Shadow(blurRadius: 3, color: Colors.black)],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'render ${avg.toStringAsFixed(2)} ms avg, '
            '${p95.toStringAsFixed(2)} ms p95 (mesh ${state._meshMs} ms)',
          ),
          Text(
            '${s.chunks} chunks, ${s.drawCalls} draws, '
            '${(s.triangles / 1000).toStringAsFixed(0)}k tris',
          ),
          Text(
            'pos ${c.position.x.toStringAsFixed(1)} '
            '${c.position.y.toStringAsFixed(1)} '
            '${c.position.z.toStringAsFixed(1)}  '
            'seed ${seedTag(state.widget.seed)}',
          ),
          Text(
            state._touchUi
                ? 'left: joystick  right: look'
                : state._mouseSupported
                ? (state._mouse.state == CaptureState.captured
                      ? 'mouse captured — Esc releases  WASD: move  space: jump'
                      : 'click: capture mouse  WASD: move')
                : 'drag: look  WASD: move  space: jump  shift: sprint',
          ),
        ],
      ),
    );
  }
}
