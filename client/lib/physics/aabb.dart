/// Axis-aligned box vs voxel grid collision — twin of `physics/aabb.ts`. Boxes
/// are moved one axis at a time and clamped against the first solid block they
/// would enter. Checked against shared/fixtures/physics/aabb.json.
library;

import 'package:block_survival/world/js_math.dart';
import 'package:block_survival/world/palette.dart';
import 'package:block_survival/world/world.dart';

final class Box {
  const Box({
    required this.x,
    required this.y,
    required this.z,
    required this.w,
    required this.h,
    required this.d,
  });

  /// min corner
  final double x;
  final double y;
  final double z;

  /// size on x, y, z
  final double w;
  final double h;
  final double d;

  Box moved(double dx, double dy, double dz) =>
      Box(x: x + dx, y: y + dy, z: z + dz, w: w, h: h, d: d);
}

const double _eps = 1e-4;

bool boxIntersectsSolid(World world, Box b) {
  final x0 = (b.x + _eps).floor();
  final x1 = (b.x + b.w - _eps).floor();
  final y0 = (b.y + _eps).floor();
  final y1 = (b.y + b.h - _eps).floor();
  final z0 = (b.z + _eps).floor();
  final z1 = (b.z + b.d - _eps).floor();
  for (var x = x0; x <= x1; x++) {
    for (var y = y0; y <= y1; y++) {
      for (var z = z0; z <= z1; z++) {
        if (isSolid(world.getBlock(x, y, z))) return true;
      }
    }
  }
  return false;
}

final class MoveResult {
  const MoveResult({
    required this.box,
    required this.hitX,
    required this.hitY,
    required this.hitZ,
  });

  final Box box;
  final bool hitX;
  final bool hitY;
  final bool hitZ;
}

/// Move `dist` along one axis (0 = x, 1 = y, 2 = z); the clamped delta and whether it hit.
(double, bool) _sweepAxis(World world, Box b, int axis, double dist) {
  if (dist == 0) return (0, false);
  final min = [b.x, b.y, b.z];
  final size = [b.w, b.h, b.d];
  final sign = jsSign(dist);
  // leading face position before and after the move
  final lead = sign > 0 ? min[axis] + size[axis] : min[axis];
  final target = lead + dist;
  // range of voxel slices the leading face passes through
  final from = sign > 0 ? (lead - _eps).floor() + 1 : (lead + _eps).floor() - 1;
  final to = sign > 0 ? (target - _eps).floor() : (target + _eps).floor();
  final oa = (axis + 1) % 3;
  final ob = (axis + 2) % 3;
  final a0 = (min[oa] + _eps).floor();
  final a1 = (min[oa] + size[oa] - _eps).floor();
  final b0 = (min[ob] + _eps).floor();
  final b1 = (min[ob] + size[ob] - _eps).floor();
  final coord = [0, 0, 0];
  final step = sign.toInt();
  for (var s = from; sign > 0 ? s <= to : s >= to; s += step) {
    for (var a = a0; a <= a1; a++) {
      for (var c = b0; c <= b1; c++) {
        coord[axis] = s;
        coord[oa] = a;
        coord[ob] = c;
        if (isSolid(world.getBlock(coord[0], coord[1], coord[2]))) {
          final wall = sign > 0 ? s : s + 1;
          return (wall - lead - sign * _eps, true);
        }
      }
    }
  }
  return (dist, false);
}

MoveResult moveBox(World world, Box box, double dx, double dy, double dz) {
  var b = box;
  final (my, hitY) = _sweepAxis(world, b, 1, dy);
  b = b.moved(0, my, 0);
  final (mx, hitX) = _sweepAxis(world, b, 0, dx);
  b = b.moved(mx, 0, 0);
  final (mz, hitZ) = _sweepAxis(world, b, 2, dz);
  b = b.moved(0, 0, mz);
  return MoveResult(box: b, hitX: hitX, hitY: hitY, hitZ: hitZ);
}

/// Ray vs box (slab test): the entry distance along the unit direction, or null.
double? rayBox(
  double ox,
  double oy,
  double oz,
  double dx,
  double dy,
  double dz,
  Box b,
) {
  var tMin = 0.0;
  var tMax = double.infinity;
  final mins = [b.x, b.y, b.z];
  final maxs = [b.x + b.w, b.y + b.h, b.z + b.d];
  final o = [ox, oy, oz];
  final d = [dx, dy, dz];
  for (var i = 0; i < 3; i++) {
    if (d[i].abs() < 1e-9) {
      if (o[i] < mins[i] || o[i] > maxs[i]) return null;
      continue;
    }
    var t1 = (mins[i] - o[i]) / d[i];
    var t2 = (maxs[i] - o[i]) / d[i];
    if (t1 > t2) {
      final t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }
  return tMin;
}
