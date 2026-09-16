import 'package:block_survival/input/touch_controls.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const screen = Size(800, 400);

  test(
    'a touch on the left half becomes a joystick, on the right a look drag',
    () {
      final c = TouchControls(joystickRadius: 50);
      c.down(1, const Offset(100, 300), screen);
      c.down(2, const Offset(600, 200), screen);
      c.move(1, const Offset(125, 300)); // half right
      c.move(2, const Offset(640, 190));
      final input = c.take();
      expect(input.move.dx, closeTo(0.5, 1e-9));
      expect(input.move.dy, closeTo(0, 1e-9));
      expect(input.look, const Offset(40, -10));
      // look accumulates until taken; the stick holds
      expect(c.take().look, Offset.zero);
      expect(c.take().move.dx, closeTo(0.5, 1e-9));
    },
  );

  test('the stick clamps to the unit circle and forward is up', () {
    final c = TouchControls(joystickRadius: 50);
    c.down(1, const Offset(100, 300), screen);
    c.move(1, const Offset(100, 100)); // far up
    expect(c.take().move, const Offset(0, 1));
    c.move(1, const Offset(400, 300)); // far right, clamped
    expect(c.take().move.dx, closeTo(1, 1e-9));
  });

  test('a second touch on the same half is ignored and lifting resets', () {
    final c = TouchControls();
    c.down(1, const Offset(100, 100), screen);
    c.down(3, const Offset(200, 100), screen);
    c.move(3, const Offset(260, 100));
    expect(
      c.take().move,
      Offset.zero,
      reason: 'pointer 3 never became the stick',
    );
    c.move(1, const Offset(130, 100));
    expect(c.take().move.dx, greaterThan(0));
    c.up(1);
    expect(c.take().move, Offset.zero);
    expect(c.joystickOrigin, isNull);
  });

  test('look deltas map to yaw/pitch with the screen convention', () {
    final a = lookToAngles(const Offset(10, -5), sensitivity: 0.1);
    expect(a.dx, closeTo(-1.0, 1e-9)); // drag right turns right (yaw decreases)
    expect(a.dy, closeTo(0.5, 1e-9)); // drag up looks up
  });

  test('buttons: sprint is held, the others are taps that drain on take', () {
    final c = TouchControls();
    c.press(TouchAction.sprint);
    c.press(TouchAction.jump);
    c.press(TouchAction.dig);
    var input = c.take();
    expect(input.held, {TouchAction.sprint});
    expect(input.taps, [TouchAction.jump, TouchAction.dig]);
    input = c.take();
    expect(input.held, {TouchAction.sprint}, reason: 'still held');
    expect(input.taps, isEmpty, reason: 'taps drained');
    c.release(TouchAction.sprint);
    expect(c.take().held, isEmpty);
  });

  testWidgets('every control is visible while idle, with labels', (
    tester,
  ) async {
    final controls = TouchControls();
    await tester.pumpWidget(
      MaterialApp(
        home: SizedBox(
          width: 800,
          height: 400,
          child: TouchControlsLayer(controls: controls),
        ),
      ),
    );
    for (final label in [
      'move',
      'swipe here to look',
      'jump',
      'sprint',
      'dig',
      'place',
      'use',
    ]) {
      expect(find.text(label), findsOneWidget, reason: label);
    }
  });

  testWidgets('the overlay routes pointer events and draws the joystick', (
    tester,
  ) async {
    final controls = TouchControls();
    await tester.pumpWidget(
      MaterialApp(
        home: SizedBox(
          width: 800,
          height: 400,
          child: TouchControlsLayer(controls: controls),
        ),
      ),
    );
    final gesture = await tester.startGesture(const Offset(100, 200));
    await gesture.moveTo(const Offset(140, 200));
    await tester.pump();
    expect(controls.take().move.dx, greaterThan(0.5));
    expect(controls.joystickOrigin, const Offset(100, 200));
    await gesture.up();
    await tester.pump();
    expect(controls.joystickOrigin, isNull);
  });

  testWidgets('buttons feed the controls and do not start a look drag', (
    tester,
  ) async {
    final controls = TouchControls();
    await tester.pumpWidget(
      MaterialApp(
        home: SizedBox(
          width: 800,
          height: 400,
          child: TouchControlsLayer(controls: controls),
        ),
      ),
    );
    await tester.tap(find.text('jump'));
    await tester.pump();
    expect(controls.take().taps, [TouchAction.jump]);

    final sprint = await tester.startGesture(
      tester.getCenter(find.text('sprint')),
    );
    await tester.pump();
    expect(controls.take().held, {TouchAction.sprint});
    expect(
      controls.isLooking,
      isFalse,
      reason: 'a button press is not a look drag',
    );
    await sprint.up();
    await tester.pump();
    expect(controls.take().held, isEmpty);
    expect(find.text('sprinting'), findsNothing);
  });
}
