/// Touch input for Android — the other half of spike S3: a virtual joystick on
/// the left half of the screen and look-drag on the right, tracked per pointer
/// so both work at once. Built on [Listener] rather than gesture recognisers,
/// which would arbitrate the two touches against each other.
library;

import 'dart:math' as math;

import 'package:flutter/widgets.dart';

/// what the touch layer reports each frame
final class TouchInput {
  const TouchInput({required this.move, required this.look});

  /// joystick vector, unit circle; x right, y forward
  final Offset move;

  /// accumulated look-drag since the last [TouchControls.take]
  final Offset look;

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

  /// where the joystick base sits while a move touch is down (for drawing)
  Offset? get joystickOrigin => _moveOrigin;
  Offset get joystick => _move;

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

  /// the frame's input; look accumulation resets
  TouchInput take() {
    final out = TouchInput(move: _move, look: _look);
    _look = Offset.zero;
    return out;
  }
}

/// Full-screen overlay: feeds [controls] and draws the joystick.
class TouchControlsLayer extends StatefulWidget {
  const TouchControlsLayer({
    super.key,
    required this.controls,
    this.buttons = const [],
  });

  final TouchControls controls;

  /// action buttons drawn bottom-right (jump, dig, place, ...)
  final List<Widget> buttons;

  @override
  State<TouchControlsLayer> createState() => _TouchControlsLayerState();
}

class _TouchControlsLayerState extends State<TouchControlsLayer> {
  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = Size(constraints.maxWidth, constraints.maxHeight);
        return Listener(
          behavior: HitTestBehavior.translucent,
          onPointerDown: (e) => setState(
            () => widget.controls.down(e.pointer, e.localPosition, size),
          ),
          onPointerMove: (e) =>
              setState(() => widget.controls.move(e.pointer, e.localPosition)),
          onPointerUp: (e) => setState(() => widget.controls.up(e.pointer)),
          onPointerCancel: (e) => setState(() => widget.controls.up(e.pointer)),
          child: Stack(
            children: [
              if (widget.controls.joystickOrigin != null)
                Positioned(
                  left:
                      widget.controls.joystickOrigin!.dx -
                      widget.controls.joystickRadius,
                  top:
                      widget.controls.joystickOrigin!.dy -
                      widget.controls.joystickRadius,
                  child: _Joystick(
                    radius: widget.controls.joystickRadius,
                    value: widget.controls.joystick,
                  ),
                ),
              Positioned(
                right: 24,
                bottom: 24,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: widget.buttons,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _Joystick extends StatelessWidget {
  const _Joystick({required this.radius, required this.value});

  final double radius;
  final Offset value;

  @override
  Widget build(BuildContext context) {
    final knob = Offset(value.dx, -value.dy) * radius;
    return SizedBox(
      width: radius * 2,
      height: radius * 2,
      child: CustomPaint(painter: _JoystickPainter(radius, knob)),
    );
  }
}

class _JoystickPainter extends CustomPainter {
  _JoystickPainter(this.radius, this.knob);

  final double radius;
  final Offset knob;

  @override
  void paint(Canvas canvas, Size size) {
    final centre = Offset(radius, radius);
    canvas.drawCircle(centre, radius, Paint()..color = const Color(0x33FFFFFF));
    canvas.drawCircle(
      centre + knob,
      radius * 0.4,
      Paint()..color = const Color(0x99FFFFFF),
    );
  }

  @override
  bool shouldRepaint(_JoystickPainter old) =>
      old.knob != knob || old.radius != radius;
}

/// yaw/pitch change for a look delta in logical pixels
Offset lookToAngles(Offset delta, {double sensitivity = 0.004}) =>
    Offset(-delta.dx * sensitivity, -delta.dy * sensitivity);

/// clamp helper for pitch
double clampPitch(double pitch) =>
    pitch.clamp(-math.pi / 2 + 0.01, math.pi / 2 - 0.01);
