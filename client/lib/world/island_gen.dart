/// Floating voxel island — twin of `server/resources/js/world/islandGen.ts`
/// (itself a port of Design/blender_scripts/islands.py `generate_island`).
///
/// Origin = island centre, y = 0 is the lowest grass layer, the island hangs below.
library;

import 'js_math.dart';
import 'noise.dart';
import 'palette.dart';

/// where generated voxels go: a template that is stamped into chunks later
abstract interface class VoxelSink {
  int getBlock(int x, int y, int z);
  void setBlock(int x, int y, int z, int id);
  void setBlockIfAir(int x, int y, int z, int id);
}

final class IslandParams {
  const IslandParams({
    required this.size,
    required this.seed,
    required this.maxHeight,
    required this.depth,
    required this.padRadius,
    required this.lake,
    required this.treeDensity,
  });

  final int size;
  final int seed;
  final int maxHeight;
  final int depth;
  final int padRadius;
  final bool lake;
  final double treeDensity;
}

/// Island_Large from islands.py — the legacy island over the spawn pad
const IslandParams islandLarge = IslandParams(
  size: 56,
  seed: 11,
  maxHeight: 9,
  depth: 16,
  padRadius: 8,
  lake: true,
  treeDensity: 0.022,
);

const IslandParams islandMedium = IslandParams(
  size: 32,
  seed: 7,
  maxHeight: 6,
  depth: 11,
  padRadius: 5,
  lake: true,
  treeDensity: 0.022,
);

final class IslandInfo {
  const IslandInfo({required this.padHeight, required this.voxelCount});

  /// y of the pad's top block
  final int padHeight;
  final int voxelCount;
}

final class _Column {
  _Column(this.x, this.z, this.h, this.dep);

  final int x;
  final int z;
  int h;
  final int dep;
}

int _colKey(int x, int z) => (x + 512) * 1024 + (z + 512);

void _addTree(VoxelSink world, int x, int y, int z, Rng rng) {
  final height = rng.randint(4, 6);
  for (var dy = 0; dy < height; dy++) {
    world.setBlock(x, y + dy, z, Block.log);
  }
  final top = y + height;
  for (var dy = -2; dy < 2; dy++) {
    final r = dy < 0 ? 2 : 1;
    for (var dx = -r; dx <= r; dx++) {
      for (var dz = -r; dz <= r; dz++) {
        if (dx.abs() == r && dz.abs() == r && dy != -1) continue;
        world.setBlockIfAir(x + dx, top + dy, z + dz, Block.leaves);
      }
    }
  }
  world.setBlock(x, top + 2, z, Block.leaves);
}

IslandInfo generateIsland(VoxelSink world, IslandParams p) {
  final size = p.size;
  final seed = p.seed;
  final maxHeight = p.maxHeight;
  final depth = p.depth;
  final padRadius = p.padRadius;
  final rng = Rng(seed);
  final n2 = fractal2(PerlinNoise(seed));
  final bigR = size / 2;
  final ri = jsTrunc(bigR);
  final seedD = seed.toDouble();

  // ---- heightmap + island mask (insertion order matters: the RNG is consumed in it)
  final heights = <int, _Column>{};
  for (var x = -ri - 1; x <= ri + 1; x++) {
    for (var z = -ri - 1; z <= ri + 1; z++) {
      final xd = x.toDouble();
      final zd = z.toDouble();
      final d = hypot(xd, zd) / bigR;
      final mask = 1 - d + 0.3 * n2(xd, zd, seedD, 0.09);
      if (mask <= 0.12) continue;
      final hRaw = mask * maxHeight + 2 * n2(xd, zd, seedD + 1, 0.16);
      var h = mask > 0.5
          ? jsRound(hRaw / 2) * 2
          : jsRound(hRaw); // terraces inland
      h = h < 0 ? 0 : (h > maxHeight + 2 ? maxHeight + 2 : h);
      var dep = jsTrunc(mask * depth + 2 * n2(xd, zd, seedD + 2, 0.13) * mask);
      dep = dep < 1 ? 1 : dep;
      heights[_colKey(x, z)] = _Column(x, z, h, dep);
    }
  }

  // ---- build pad: flat, at the height of the surrounding terrain
  var padHeight = 2;
  if (padRadius != 0) {
    final ring = <int>[];
    for (final c in heights.values) {
      final dist = hypot(c.x.toDouble(), c.z.toDouble());
      if (dist > padRadius && dist <= padRadius + 3) ring.add(c.h);
    }
    if (ring.isNotEmpty) {
      ring.sort();
      padHeight =
          jsRound(ring[ring.length >> 1] / 2) *
          2; // median, snapped to a terrace
    }
    for (final c in heights.values) {
      if (hypot(c.x.toDouble(), c.z.toDouble()) <= padRadius) c.h = padHeight;
    }
  }

  // ---- lake: pick a spot on a ring that clears the pad
  final lakeCells = <int>{};
  var lakeLevel = 0;
  if (p.lake) {
    final lrRaw = jsTrunc(size / 9);
    final lr = lrRaw > 2 ? lrRaw : 2;
    final minLakeDist = (padRadius + lr + 3).toDouble();
    final maxLakeRaw = bigR * 0.7;
    final maxLakeDist = maxLakeRaw > minLakeDist ? maxLakeRaw : minLakeDist;
    final angle = rng.random() * jsPi * 2;
    final dist = minLakeDist + rng.random() * (maxLakeDist - minLakeDist);
    final lx = jsRound(jsCos(angle) * dist);
    final lz = jsRound(jsSin(angle) * dist);
    for (final c in heights.values) {
      if (hypot((c.x - lx).toDouble(), (c.z - lz).toDouble()) <=
          lr + 0.6 * n2(c.x.toDouble(), c.z.toDouble(), seedD + 3, 0.3)) {
        lakeCells.add(_colKey(c.x, c.z));
      }
    }
    if (lakeCells.isNotEmpty) {
      var lowest = 1 << 30;
      for (final k in lakeCells) {
        final h = heights[k]!.h;
        if (h < lowest) lowest = h;
      }
      lakeLevel = lowest;
    }
  }

  // ---- fill columns
  var voxelCount = 0;
  for (final c in heights.values) {
    final x = c.x;
    final z = c.z;
    final h = c.h;
    if (lakeCells.contains(_colKey(x, z))) {
      final floor = lakeLevel - 2;
      for (var y = -c.dep; y < floor; y++) {
        world.setBlock(x, y, z, Block.stone);
        voxelCount++;
      }
      world.setBlock(x, floor, z, Block.sand);
      voxelCount++;
      for (var y = floor + 1; y <= lakeLevel; y++) {
        world.setBlock(x, y, z, Block.water);
        voxelCount++;
      }
      continue;
    }
    var nearLake = false;
    for (var dx = -1; dx <= 1 && !nearLake; dx++) {
      for (var dz = -1; dz <= 1; dz++) {
        if (lakeCells.contains(_colKey(x + dx, z + dz))) {
          nearLake = true;
          break;
        }
      }
    }
    for (var y = -c.dep; y <= h; y++) {
      int kind;
      if (y == h) {
        kind = nearLake && h <= lakeLevel + 1 ? Block.sand : Block.grass;
      } else if (y >= h - 2) {
        kind = Block.dirt;
      } else {
        kind = Block.stone;
        // one roll, as before: adding copper to the ladder must not shift the island's RNG
        final r = rng.random();
        if (r < 0.03) {
          kind = Block.oreCoal;
        } else if (r < 0.045) {
          kind = Block.oreIron;
        } else if (r < 0.055) {
          kind = Block.oreCopper;
        }
      }
      world.setBlock(x, y, z, kind);
      voxelCount++;
    }
    // snow on the highest peaks of big islands
    if (h >= maxHeight + 1 && size >= 40) world.setBlock(x, h, z, Block.snow);
  }

  // ---- trees on grass, not on the pad
  final grassCells = <(int, int, int)>[];
  for (final c in heights.values) {
    if (lakeCells.contains(_colKey(c.x, c.z))) continue;
    if (world.getBlock(c.x, c.h, c.z) != Block.grass) continue;
    final dist = hypot(c.x.toDouble(), c.z.toDouble());
    // +3: the radius-2 canopy must not overhang the pad
    if (dist > padRadius + 3 && dist < bigR * 0.85) {
      grassCells.add((c.x, c.h, c.z));
    }
  }
  final shuffled = rng.shuffle(grassCells);
  final placed = <(int, int)>[];
  final target = jsTrunc(grassCells.length * p.treeDensity);
  for (final (x, y, z) in shuffled) {
    if (placed.length >= target) break;
    if (placed.every((q) => (x - q.$1).abs() > 3 || (z - q.$2).abs() > 3)) {
      _addTree(world, x, y + 1, z, rng);
      placed.add((x, z));
    }
  }

  return IslandInfo(padHeight: padHeight, voxelCount: voxelCount);
}
