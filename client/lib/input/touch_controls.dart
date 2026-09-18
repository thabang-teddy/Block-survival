/// Touch input for Android — the other half of spike S3: a virtual joystick on
/// the left half of the screen, look-drag on the right, and action buttons
/// bottom-right, tracked per pointer so all of them work at once. Built on
/// [Listener] rather than gesture recognisers, which would arbitrate the
/// touches against each other.
///
/// Every control is drawn even when idle so the player can see where it is:
/// the joystick rests at its home position until a touch picks it up, the
/// look zone is outlined with a hint, and the buttons are labelled.
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

/// the buttons; [sprint] is held, the others are tapped
enum TouchAction { jump, sprint, dig, place, interact }

/// what the touch layer reports each frame
final class TouchInput {
  const TouchInput({
    required this.move,
    required this.look,
    this.held = const {},
    this.taps = const [],
  });

  /// joystick vector, unit circle; x right, y forward
  final Offset move;

  /// accumulated look-drag since the last [TouchControls.take]
  final Offset look;

  /// buttons down right now (sprint)
  final Set<TouchAction> held;

  /// buttons tapped since the last take, in order (jump, dig, place, interact)
  final List<TouchAction> taps;

  static const none = TouchInput(move: Offset.zero, look: Offset.zero);
}

/// Pure state machine behind the widget, so it can be unit-tested without a
/// widget tree: pointers are classified by which half they start in.
final class TouchControls {
  TouchControls({this.joystickRadius = 60});

  final double joystickRadius;

  int? _movePointer;
  Offset? _moveOrigin;
  Offset _move = Offset.zero;
  int? _lookPointer;
  Offset? _lookLast;
  Offset _look = Offset.zero;
  final Set<TouchAction> _held = {};
  final List<TouchAction> _taps = [];

  /// where the joystick base sits while a move touch is down (for drawing)
  Offset? get joystickOrigin => _moveOrigin;
  Offset get joystick => _move;
  bool get isLooking => _lookPointer != null;
  Set<TouchAction> get held => Set.unmodifiable(_held);

  void down(int pointer, Offset position, Size screen) {
    if (position.dx < screen.width / 2) {
      if (_movePointer != null) return;
      _movePointer = pointer;
      _moveOrigin = position;
      _move = Offset.zero;
    } else {
      if (_lookPointer != null) return;
      _lookPointer = pointer;
      _lookLast = position;
    }
  }

  void move(int pointer, Offset position) {
    if (pointer == _movePointer) {
      final d = position - _moveOrigin!;
      final len = d.distance;
      final clamped = len > joystickRadius ? d / len * joystickRadius : d;
      // screen y grows downwards; forward is up
      _move = Offset(clamped.dx / joystickRadius, -clamped.dy / joystickRadius);
    } else if (pointer == _lookPointer) {
      _look += position - _lookLast!;
      _lookLast = position;
    }
  }

  void up(int pointer) {
    if (pointer == _movePointer) {
      _movePointer = null;
      _moveOrigin = null;
      _move = Offset.zero;
    } else if (pointer == _lookPointer) {
      _lookPointer = null;
      _lookLast = null;
    }
  }

  /// a button went down: held actions stay until [release], the rest are taps
  void press(TouchAction action) {
    if (action == TouchAction.sprint) {
      _held.add(action);
    } else {
      _taps.add(action);
    }
  }

  void release(TouchAction action) => _held.remove(action);

  /// the frame's input; look and taps reset, the stick and held buttons persist
  TouchInput take() {
    final out = TouchInput(
      move: _move,
      look: _look,
      held: Set.of(_held),
      taps: List.of(_taps),
    );
    _look = Offset.zero;
    _taps.clear();
    return out;
  }
}

/// Full-screen overlay: feeds [controls] and draws every control where it is.
class TouchControlsLayer extends StatefulWidget {
  const TouchControlsLayer({
    super.key,
    required this.controls,
    this.showCrosshair = true,
    this.onPause,
  });

  final TouchControls controls;
  final bool showCrosshair;

  /// the ☰ button top-right; null hides it
  final VoidCallback? onPause;

  @override
  State<TouchControlsLayer> createState() => _TouchControlsLayerState();
}

class _TouchControlsLayerState extends State<TouchControlsLayer> {
  static const double _margin = 28;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = Size(constraints.maxWidth, constraints.maxHeight);
        final c = widget.controls;
        final r = c.joystickRadius;
        // the joystick rests bottom-left until a touch picks it up
        final home = Offset(_margin + r, size.height - _margin - r);
        final origin = c.joystickOrigin ?? home;
        return Stack(
          fit: StackFit.expand,
          children: [
            // the touch surface: the buttons above it absorb their own taps
            Listener(
              behavior: HitTestBehavior.opaque,
              onPointerDown: (e) =>
                  setState(() => c.down(e.pointer, e.localPosition, size)),
              onPointerMove: (e) =>
                  setState(() => c.move(e.pointer, e.localPosition)),
              onPointerUp: (e) => setState(() => c.up(e.pointer)),
              onPointerCancel: (e) => setState(() => c.up(e.pointer)),
              child: CustomPaint(
                painter: _ZonesPainter(
                  size: size,
                  joystickOrigin: origin,
                  joystickRadius: r,
                  joystick: c.joystick,
                  joystickActive: c.joystickOrigin != null,
                  looking: c.isLooking,
                  crosshair: widget.showCrosshair,
                ),
              ),
            ),
            // zone hints
            Positioned(
              left: origin.dx - r,
              top: origin.dy + r + 6,
              width: r * 2,
              child: const _Hint('move', Icons.gamepad_outlined),
            ),
            Positioned(
              right: _margin,
              top: widget.onPause == null ? _margin : _margin + 52,
              child: _Hint(
                c.isLooking ? 'looking' : 'swipe here to look',
                Icons.threesixty,
              ),
            ),
            if (widget.onPause != null)
              Positioned(
                right: _margin,
                top: _margin,
                child: Semantics(
                  button: true,
                  label: 'pause',
                  child: Listener(
                    behavior: HitTestBehavior.opaque,
                    onPointerDown: (_) => widget.onPause!(),
                    child: Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: const Color(0x44000000),
                        border: Border.all(color: Colors.white70, width: 2),
                      ),
                      child: const Icon(Icons.menu, color: Colors.white),
                    ),
                  ),
                ),
              ),
            // action buttons, bottom-right
            Positioned(
              right: _margin,
              bottom: _margin,
              child: _ActionCluster(controls: c),
            ),
          ],
        );
      },
    );
  }
}

class _Hint extends StatelessWidget {
  const _Hint(this.text, this.icon);

  final String text;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
      Icon(icon, size: 16, color: Colors.white70),
      const SizedBox(width: 6),
      Text(
        text,
        style: const TextStyle(
          color: Colors.white70,
          fontSize: 12,
          shadows: [Shadow(blurRadius: 3, color: Colors.black)],
        ),
      ),
    ],
  );
}

/// jump / dig / place / interact tap, sprint hold
class _ActionCluster extends StatelessWidget {
  const _ActionCluster({required this.controls});

  final TouchControls controls;

  @override
  Widget build(BuildContext context) {
    final sprinting = controls.held.contains(TouchAction.sprint);
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _ActionButton(
              action: TouchAction.dig,
              icon: Icons.hardware,
              label: 'dig',
              controls: controls,
            ),
            const SizedBox(width: 12),
            _ActionButton(
              action: TouchAction.place,
              icon: Icons.add_box_outlined,
              label: 'place',
              controls: controls,
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _ActionButton(
              action: TouchAction.interact,
              icon: Icons.touch_app_outlined,
              label: 'use',
              controls: controls,
            ),
            const SizedBox(width: 12),
            _ActionButton(
              action: TouchAction.sprint,
              icon: Icons.directions_run,
              label: sprinting ? 'sprinting' : 'sprint',
              controls: controls,
              active: sprinting,
            ),
            const SizedBox(width: 12),
            _ActionButton(
              action: TouchAction.jump,
              icon: Icons.arrow_upward,
              label: 'jump',
              controls: controls,
              large: true,
            ),
          ],
        ),
      ],
    );
  }
}

class _ActionButton extends StatefulWidget {
  const _ActionButton({
    required this.action,
    required this.icon,
    required this.label,
    required this.controls,
    this.active = false,
    this.large = false,
  });

  final TouchAction action;
  final IconData icon;
  final String label;
  final TouchControls controls;
  final bool active;
  final bool large;

  @override
  State<_ActionButton> createState() => _ActionButtonState();
}

class _ActionButtonState extends State<_ActionButton> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final size = widget.large ? 76.0 : 60.0;
    final lit = _down || widget.active;
    return Semantics(
      button: true,
      label: widget.label,
      child: Listener(
        behavior: HitTestBehavior.opaque,
        onPointerDown: (_) {
          setState(() => _down = true);
          widget.controls.press(widget.action);
        },
        onPointerUp: (_) {
          setState(() => _down = false);
          widget.controls.release(widget.action);
        },
        onPointerCancel: (_) {
          setState(() => _down = false);
          widget.controls.release(widget.action);
        },
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: size,
              height: size,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: lit ? const Color(0xCCFFFFFF) : const Color(0x44000000),
                border: Border.all(color: Colors.white70, width: 2),
              ),
              child: Icon(
                widget.icon,
                size: size * 0.5,
                color: lit ? Colors.black87 : Colors.white,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              widget.label,
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 11,
                shadows: [Shadow(blurRadius: 3, color: Colors.black)],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// joystick, look zone and crosshair in one paint
class _ZonesPainter extends CustomPainter {
  _ZonesPainter({
    required this.size,
    required this.joystickOrigin,
    required this.joystickRadius,
    required this.joystick,
    required this.joystickActive,
    required this.looking,
    required this.crosshair,
  });

  final Size size;
  final Offset joystickOrigin;
  final double joystickRadius;
  final Offset joystick;
  final bool joystickActive;
  final bool looking;
  final bool crosshair;

  @override
  void paint(Canvas canvas, Size _) {
    // look zone: the right half, outlined faintly, brighter while in use
    final zone = Rect.fromLTWH(
      size.width / 2 + 8,
      8,
      size.width / 2 - 16,
      size.height - 16,
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(zone, const Radius.circular(18)),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5
        ..color = looking ? const Color(0x66FFFFFF) : const Color(0x22FFFFFF),
    );

    // joystick: base ring + knob; the ring is dashed while resting at home
    final r = joystickRadius;
    canvas.drawCircle(
      joystickOrigin,
      r,
      Paint()
        ..color = joystickActive
            ? const Color(0x44FFFFFF)
            : const Color(0x22FFFFFF),
    );
    canvas.drawCircle(
      joystickOrigin,
      r,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = Colors.white70,
    );
    final knob = joystickOrigin + Offset(joystick.dx, -joystick.dy) * r;
    canvas.drawCircle(knob, r * 0.4, Paint()..color = const Color(0xAAFFFFFF));
    // direction ticks so the resting stick reads as a d-pad
    for (final (dx, dy) in const [
      (0.0, -1.0),
      (0.0, 1.0),
      (-1.0, 0.0),
      (1.0, 0.0),
    ]) {
      final tip = joystickOrigin + Offset(dx, dy) * (r - 10);
      canvas.drawCircle(tip, 3, Paint()..color = Colors.white54);
    }

    if (crosshair) {
      final c = Offset(size.width / 2, size.height / 2);
      final p = Paint()
        ..color = Colors.white
        ..strokeWidth = 2;
      canvas.drawLine(c - const Offset(10, 0), c + const Offset(10, 0), p);
      canvas.drawLine(c - const Offset(0, 10), c + const Offset(0, 10), p);
    }
  }

  @override
  bool shouldRepaint(_ZonesPainter old) =>
      old.joystickOrigin != joystickOrigin ||
      old.joystick != joystick ||
      old.joystickActive != joystickActive ||
      old.looking != looking ||
      old.size != size ||
      old.crosshair != crosshair;
}

/// yaw/pitch change for a look delta in logical pixels
Offset lookToAngles(Offset delta, {double sensitivity = 0.004}) =>
    Offset(-delta.dx * sensitivity, -delta.dy * sensitivity);

/// clamp helper for pitch
double clampPitch(double pitch) =>
    pitch.clamp(-math.pi / 2 + 0.01, math.pi / 2 - 0.01);
