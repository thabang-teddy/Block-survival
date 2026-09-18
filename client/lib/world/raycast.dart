/// DDA voxel raycast (Amanatides & Woo) — twin of `world/raycast.ts`. The first
/// non-air block hit within `maxDist`, with the face normal the ray entered
/// through. Checked against shared/fixtures/physics/raycast.json.
library;

import 'package:block_survival/world/js_math.dart';
import 'package:block_survival/world/palette.dart';
import 'package:block_survival/world/world.dart';

final class RayHit {
  const RayHit({
    required this.x,
    required this.y,
    required this.z,
    required this.nx,
    required this.ny,
    required this.nz,
    required this.distance,
    required this.block,
  });

  final int x;
  final int y;
  final int z;

  /// face normal of the entered face; place a block at (x, y, z) + normal
  final int nx;
  final int ny;
  final int nz;
  final double distance;
  final int block;
}

RayHit? raycastVoxels(
  World world,
  double ox,
  double oy,
  double oz,
  double dx,
  double dy,
  double dz,
  double maxDist, {
  bool ignoreWater = true,
}) {
  final len = hypot3(dx, dy, dz);
  if (len == 0) return null;
  dx /= len;
  dy /= len;
  dz /= len;

  var x = ox.floor();
  var y = oy.floor();
  var z = oz.floor();
  final stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
  final stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
  final stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);
  final tDeltaX = stepX != 0 ? (1 / dx).abs() : double.infinity;
  final tDeltaY = stepY != 0 ? (1 / dy).abs() : double.infinity;
  final tDeltaZ = stepZ != 0 ? (1 / dz).abs() : double.infinity;
  var tMaxX = stepX > 0
      ? (x + 1 - ox) / dx
      : (stepX < 0 ? (x - ox) / dx : double.infinity);
  var tMaxY = stepY > 0
      ? (y + 1 - oy) / dy
      : (stepY < 0 ? (y - oy) / dy : double.infinity);
  var tMaxZ = stepZ > 0
      ? (z + 1 - oz) / dz
      : (stepZ < 0 ? (z - oz) / dz : double.infinity);

  var nx = 0;
  var ny = 0;
  var nz = 0;
  var t = 0.0;
  // starting inside a block still reports it, with a zero normal
  for (var i = 0; i < 512; i++) {
    final block = world.getBlock(x, y, z);
    if (block != air && !(ignoreWater && block == Block.water)) {
      return RayHit(
        x: x,
        y: y,
        z: z,
        nx: nx,
        ny: ny,
        nz: nz,
        distance: t,
        block: block,
      );
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      t = tMaxX;
      tMaxX += tDeltaX;
      x += stepX;
      nx = -stepX;
      ny = 0;
      nz = 0;
    } else if (tMaxY < tMaxZ) {
      t = tMaxY;
      tMaxY += tDeltaY;
      y += stepY;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      z += stepZ;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }
    if (t > maxDist) return null;
  }
  return null;
}
