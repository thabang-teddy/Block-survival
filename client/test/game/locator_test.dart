// Finding the other players: fixes and screen markers (twin of
// game/__tests__/locator.test.ts).
import 'dart:math' as math;

import 'package:block_survival/game/locator.dart';
import 'package:block_survival/render/camera.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vector_math/vector_math_64.dart';

double deg(double rad) => rad * 180 / math.pi;

/// the game's first-person camera at the origin, 16:9, looking down −z
Matrix4 viewProjection({double yaw = 0, double pitch = 0}) =>
    Camera(fovYDegrees: 75, yaw: yaw, pitch: pitch).viewProjection(16 / 9);

Vector3 v(double x, double y, double z) => Vector3(x, y, z);

void main() {
  group('fixOf', () {
    test('straight ahead is bearing 0, with the straight-line distance', () {
      final fix = fixOf(x: 0, y: 40, z: 0, yaw: 0, other: v(0, 40, -30));
      expect(fix.distance, closeTo(30, 1e-9));
      expect(fix.bearing, closeTo(0, 1e-9));
      expect(fix.dy, 0);
    });

    test('to the right is +90°, to the left −90°, behind ±180°', () {
      Fix at(double ox, double oz) =>
          fixOf(x: 10, y: 40, z: 10, yaw: 0, other: v(ox, 40, oz));
      expect(deg(at(20, 10).bearing), closeTo(90, 1e-9));
      expect(deg(at(0, 10).bearing), closeTo(-90, 1e-9));
      expect(deg(at(10, 20).bearing).abs(), closeTo(180, 1e-9));
    });

    test('the bearing follows the view: turned left 90°, −x is ahead', () {
      final fix = fixOf(x: 0, y: 0, z: 0, yaw: math.pi / 2, other: v(-5, 0, 0));
      expect(deg(fix.bearing), closeTo(0, 1e-9));
    });

    test('height is kept apart from the flat bearing, in the distance', () {
      final fix = fixOf(x: 0, y: 40, z: 0, yaw: 0, other: v(3, 44, 0));
      expect(fix.dy, 4);
      expect(fix.distance, 5);
      expect(deg(fix.bearing), closeTo(90, 1e-9));
    });
  });

  group('projectMarker', () {
    test('a player in front sits on screen where the camera sees them', () {
      final m = projectMarker(viewProjection(), 0, 0, -20);
      expect(m.onScreen, isTrue);
      expect(m.x, closeTo(0, 1e-6));
      expect(m.y, closeTo(0, 1e-6));
    });

    test('slightly right of centre lands right of centre, on screen', () {
      final m = projectMarker(viewProjection(), 5, 0, -20);
      expect(m.onScreen, isTrue);
      expect(m.x, greaterThan(0));
      expect(m.x, lessThan(1));
    });

    test('far right leaves the screen: right edge, arrow pointing right', () {
      final m = projectMarker(viewProjection(), 50, 0, -5);
      expect(m.onScreen, isFalse);
      expect(m.x, closeTo(1 - markerMargin, 1e-6));
      expect(m.y.abs(), lessThan(markerMargin));
      expect(m.angle, closeTo(90, 1e-6));
    });

    test('behind on the left pins to the left edge below centre', () {
      final m = projectMarker(viewProjection(), -20, 0, 5);
      expect(m.onScreen, isFalse);
      expect(m.x, closeTo(-(1 - markerMargin), 1e-6));
      expect(m.y, lessThan(0));
      expect(m.angle, greaterThan(-135));
      expect(m.angle, lessThan(-90));
    });

    test('behind and high up still goes to the bottom edge', () {
      final m = projectMarker(viewProjection(), 0, 20, 30);
      expect(m.onScreen, isFalse);
      expect(m.y, closeTo(-(1 - markerMargin), 1e-6));
      expect(m.angle.abs(), closeTo(180, 1e-6));
    });

    test('straight behind points down', () {
      final m = projectMarker(viewProjection(), 0, 0, 20);
      expect(m.onScreen, isFalse);
      expect(m.x, closeTo(0, 1e-6));
      expect(m.y, closeTo(-(1 - markerMargin), 1e-6));
      expect(m.angle.abs(), closeTo(180, 1e-6));
    });

    test('above the view pins to the top edge with the arrow up', () {
      final m = projectMarker(viewProjection(), 0, 40, -5);
      expect(m.onScreen, isFalse);
      expect(m.y, closeTo(1 - markerMargin, 1e-6));
      expect(m.angle, closeTo(0, 1e-6));
    });

    test('the margin keeps an in-frustum player near the edge inside it', () {
      final m = projectMarker(viewProjection(), 13, 0, -10, margin: 0.2);
      expect(m.onScreen, isFalse);
      expect(m.x, closeTo(0.8, 1e-6));
    });
  });

  group('whereOf / verticalHint', () {
    test('rounds for the scoreboard and quantises the arrow', () {
      final w = whereOf(x: 0, y: 40, z: 0, yaw: 0, other: v(30.4, 47, -30));
      expect(w.distance, 43);
      expect(w.bearing, 45);
      expect(w.dy, 7);
    });

    test('the up/down hint only speaks up for a real height difference', () {
      expect(verticalHint(3), '');
      expect(verticalHint(-5), '');
      expect(verticalHint(6), '6 m up');
      expect(verticalHint(-24), '24 m down');
    });
  });
}
