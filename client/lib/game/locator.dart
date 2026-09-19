/// Finding the other players (issue #15) — twin of `game/locator.ts`. The
/// world has no edge, so once players split up nothing tells them where the
/// others went. A [Fix] (distance and bearing relative to the view) feeds the
/// scoreboard; [projectMarker] places the HUD markers, which sit on a player
/// in view and hug the screen edge pointing at one who is not.
library;

import 'dart:math' as math;

import 'package:vector_math/vector_math_64.dart';

/// how far inside the edge an off-screen marker is pinned (of the half-screen)
const double markerMargin = 0.08;

/// the scoreboard arrow is rounded to this so the row text stays still
const int bearingStepDeg = 15;

/// a height difference smaller than this is not worth a hint
const int verticalHintMetres = 6;

/// where another player is, relative to the local player's view
final class Fix {
  const Fix({required this.distance, required this.bearing, required this.dy});

  /// metres, straight line
  final double distance;

  /// radians relative to the view: 0 ahead, +π/2 to the right, ±π behind
  final double bearing;

  /// metres above (+) or below (−) the local player
  final double dy;
}

/// the fix as the scoreboard shows it: whole metres, the arrow in 15° steps
final class Where {
  const Where({
    required this.distance,
    required this.bearing,
    required this.dy,
  });

  final int distance;

  /// degrees clockwise from ahead
  final int bearing;
  final int dy;

  @override
  bool operator ==(Object other) =>
      other is Where &&
      other.distance == distance &&
      other.bearing == bearing &&
      other.dy == dy;

  @override
  int get hashCode => Object.hash(distance, bearing, dy);
}

/// a marker's place in normalised device coordinates (−1..1 both ways)
final class Marker {
  const Marker({
    required this.x,
    required this.y,
    required this.onScreen,
    required this.angle,
  });

  final double x;
  final double y;

  /// in view: the marker sits on the player; else it is pinned to the edge and points
  final bool onScreen;

  /// degrees clockwise from straight up, for the off-screen arrow
  final double angle;
}

/// yaw is the camera's: 0 looks down −z, positive turns left
Fix fixOf({
  required double x,
  required double y,
  required double z,
  required double yaw,
  required Vector3 other,
}) {
  final dx = other.x - x;
  final dy = other.y - y;
  final dz = other.z - z;
  final ahead = dx * -math.sin(yaw) + dz * -math.cos(yaw);
  final right = dx * math.cos(yaw) + dz * -math.sin(yaw);
  return Fix(
    distance: math.sqrt(dx * dx + dy * dy + dz * dz),
    bearing: math.atan2(right, ahead),
    dy: dy,
  );
}

Where whereOf({
  required double x,
  required double y,
  required double z,
  required double yaw,
  required Vector3 other,
}) {
  final fix = fixOf(x: x, y: y, z: z, yaw: yaw, other: other);
  final deg = fix.bearing * 180 / math.pi;
  return Where(
    distance: fix.distance.round(),
    bearing: (deg / bearingStepDeg).round() * bearingStepDeg,
    dy: fix.dy.round(),
  );
}

/// "12 m up" / "12 m down", or nothing when the other player is roughly level
String verticalHint(num dy) {
  final abs = dy.round().abs();
  if (abs < verticalHintMetres) return '';
  return '$abs m ${dy > 0 ? 'up' : 'down'}';
}

/// Project a world point through a view-projection matrix. A point outside
/// the view is pushed out along its direction from the screen centre and
/// pinned inside [margin]. A point behind the camera goes to the bottom edge,
/// sliding to the side it is on: the cue that matters there is which way to
/// turn, not how high up they are.
Marker projectMarker(
  Matrix4 vp,
  double x,
  double y,
  double z, {
  double margin = markerMargin,
}) {
  final e = vp.storage; // column-major, as three.js
  final cx = e[0] * x + e[4] * y + e[8] * z + e[12];
  final cy = e[1] * x + e[5] * y + e[9] * z + e[13];
  final cw = e[3] * x + e[7] * y + e[11] * z + e[15];
  final bound = 1 - margin;
  // dividing by |w| keeps a point behind the camera on the side it really is
  final depth = math.max(cw.abs(), 1e-6);
  var nx = cx / depth;
  var ny = cy / depth;
  if (cw > 0) {
    if (nx.abs() <= bound && ny.abs() <= bound) {
      return Marker(x: nx, y: ny, onScreen: true, angle: 0);
    }
  } else {
    ny = -1;
  }
  final extent = math.max(math.max(nx.abs(), ny.abs()), 1e-6);
  nx /= extent;
  ny /= extent;
  final angle = math.atan2(nx, ny) * 180 / math.pi;
  return Marker(x: nx * bound, y: ny * bound, onScreen: false, angle: angle);
}
