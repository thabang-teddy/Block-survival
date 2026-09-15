/// Updraft columns — twin of `server/resources/js/world/updraft.ts`. Every floating
/// island has one glowing shaft rising from the ground to just above its rim; a pure
/// function of the island, so host, clients and reloads agree on where it is.
library;

import 'island_field.dart';
import 'island_template.dart';
import 'palette.dart';

final class Updraft {
  const Updraft({
    required this.x,
    required this.z,
    required this.bottomY,
    required this.topY,
    required this.radius,
    required this.ix,
    required this.iz,
  });

  /// world x/z of the shaft axis (block centres)
  final double x;
  final double z;

  /// the shaft lifts between these world heights (feet y)
  final int bottomY;
  final int topY;
  final double radius;

  /// the island it serves
  final int ix;
  final int iz;
}

abstract final class UpdraftTuning {
  static const double radius = 1.25;

  /// blocks of clear air between the island's edge and the shaft axis
  static const int gap = 2;

  /// how far above the rim the lift keeps working
  static const int aboveRim = 3;
  static const double rise = 6;
  static const double sink = 4;

  /// m/s² towards the wanted vertical speed
  static const double accel = 40;
}

/// rim search order: east first, then the other cardinal directions
const List<(int, int)> _directions = [(1, 0), (-1, 0), (0, 1), (0, -1)];
const int _stripDepth = UpdraftTuning.gap + 2;
const int _stripHalfWidth = 1;

typedef GroundHeight = int Function(int x, int z);

/// no island block at all (shore, roots, trees) in this island-local column
bool _columnIsClear(IslandTemplate t, int x, int z) {
  for (var y = t.minY; y <= t.maxY; y++) {
    if (t.get(x, y, z) != air) return false;
  }
  return true;
}

/// highest ground-like block (not a tree) in an island-local column, or null
int? _rimTop(IslandTemplate t, int x, int z) {
  for (var y = t.maxY; y >= t.minY; y--) {
    final id = t.get(x, y, z);
    if (id != air && id != Block.log && id != Block.leaves) return y;
  }
  return null;
}

/// The shaft for an island: walk outward from the centre until a strip of columns
/// is clear of the island, and put the axis `gap` blocks past the edge.
Updraft updraftFor(
  PlacedIsland island,
  IslandTemplate t,
  GroundHeight groundHeight,
) {
  final extent =
      [-t.minX, t.maxX, -t.minZ, t.maxZ].reduce((a, b) => a > b ? a : b) + 1;
  for (final (ux, uz) in _directions) {
    final px = -uz;
    final pz = ux;
    int? rim; // top of the last island column met on this ray
    for (var d = 0; d <= extent; d++) {
      final top = _rimTop(t, d * ux, d * uz);
      if (top != null) rim = top;
      if (d == 0 || rim == null) continue;
      var clear = true;
      for (var k = 0; k < _stripDepth && clear; k++) {
        for (var m = -_stripHalfWidth; m <= _stripHalfWidth; m++) {
          if (!_columnIsClear(
            t,
            (d + k) * ux + m * px,
            (d + k) * uz + m * pz,
          )) {
            clear = false;
            break;
          }
        }
      }
      if (!clear) continue;
      final bx = island.x + (d + UpdraftTuning.gap) * ux;
      final bz = island.z + (d + UpdraftTuning.gap) * uz;
      return Updraft(
        x: bx + 0.5,
        z: bz + 0.5,
        bottomY: groundHeight(bx, bz) + 1,
        topY: island.baseY + rim + UpdraftTuning.aboveRim,
        radius: UpdraftTuning.radius,
        ix: island.ix,
        iz: island.iz,
      );
    }
  }
  throw StateError('no clear rim for island ${island.ix},${island.iz}');
}

/// the shaft the point is inside, if any
Updraft? updraftAt(List<Updraft> shafts, double x, double y, double z) {
  for (final u in shafts) {
    if (y < u.bottomY || y > u.topY) continue;
    final dx = x - u.x;
    final dz = z - u.z;
    if (dx * dx + dz * dz <= u.radius * u.radius) return u;
  }
  return null;
}
