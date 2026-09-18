/// The endless ground layer — twin of `server/resources/js/world/groundGen.ts`.
/// Everything is a pure function of (seed, x, z).
library;

import 'js_math.dart';
import 'noise.dart';
import 'palette.dart';

const int seaLevel = 32;
const int groundMin = 24;
const int groundMax = 52;

/// radius of the flat grass pad the player starts on
const int padRadius = 8;

/// blocks over which the pad eases into the natural terrain
const int padBlend = 4;

/// no water inside this radius of the origin
const int dryRadius = 16;
const double treeDensity = 0.006;

/// two trees are never within this Chebyshev distance of each other
const int treeSpacing = 3;
const int treeMinHeight = 4;
const int treeMaxHeight = 6;

const int _saltTree = 101;
const int _saltTreeHeight = 102;
const int _sliceBroad = 11;
const int _sliceDetail = 12;
const int _sliceRidge = 13;

int _clamp(int v, int lo, int hi) => v < lo ? lo : (v > hi ? hi : v);
double _smoothstep(double t) => t * t * (3 - 2 * t);

typedef HeightAt = int Function(int x, int z);

final class GroundModel {
  GroundModel(this.seed) : _n2 = fractal2(PerlinNoise(seed ^ 0x5eed)) {
    padHeight = _computePadHeight();
  }

  final int seed;

  /// y of the spawn pad's top block
  late final int padHeight;
  final Fractal2 _n2;

  /// terrain height before the pad and dry zone are applied
  int naturalHeight(int x, int z) {
    final xd = x.toDouble();
    final zd = z.toDouble();
    final broad = _n2(xd, zd, (seed + _sliceBroad).toDouble(), 0.011);
    final detail = _n2(xd, zd, (seed + _sliceDetail).toDouble(), 0.045);
    final ridge = _n2(xd, zd, (seed + _sliceRidge).toDouble(), 0.02);
    var h = 36 + 9 * broad + 2.5 * detail;
    // cliffs: a steep 9-block step where the ridge noise peaks
    if (ridge > 0.55) {
      final step = (ridge - 0.55) * 4;
      h += (step < 1 ? step : 1.0) * 9;
    }
    return _clamp(jsRound(h), groundMin, groundMax);
  }

  /// height of the top block of a column
  int height(int x, int z) {
    final d = hypot(x.toDouble(), z.toDouble());
    if (d <= padRadius) return padHeight;
    // keep the spawn area dry: the minimum height ramps down away from the origin
    final away = d - dryRadius;
    final floor = (seaLevel + 2 - (away > 0 ? away : 0.0)).ceil();
    final natural = naturalHeight(x, z);
    final nat = natural > floor ? natural : floor;
    if (d > padRadius + padBlend) return nat;
    final t = _smoothstep((d - padRadius) / padBlend);
    return jsRound(padHeight + (nat - padHeight) * t);
  }

  static int surfaceFor(int h) => h <= seaLevel + 1 ? Block.sand : Block.grass;

  /// Trunk height of the tree rooted at this column, or 0.
  int treeHeight(int x, int z, HeightAt heightAt) {
    final r = hash01(seed, x, z, _saltTree);
    if (r >= treeDensity) return 0;
    if (surfaceFor(heightAt(x, z)) != Block.grass) return 0;
    if (hypot(x.toDouble(), z.toDouble()) <= padRadius + padBlend + 2) return 0;
    for (var dx = -2; dx <= 2; dx++) {
      for (var dz = -2; dz <= 2; dz++) {
        if (heightAt(x + dx, z + dz) < seaLevel) return 0;
      }
    }
    for (var dx = -treeSpacing; dx <= treeSpacing; dx++) {
      for (var dz = -treeSpacing; dz <= treeSpacing; dz++) {
        if (dx == 0 && dz == 0) continue;
        final r2 = hash01(seed, x + dx, z + dz, _saltTree);
        if (r2 < treeDensity &&
            (r2 < r || (r2 == r && (dx < 0 || (dx == 0 && dz < 0))))) {
          return 0;
        }
      }
    }
    return treeMinHeight +
        (hash01(seed, x, z, _saltTreeHeight) *
                (treeMaxHeight - treeMinHeight + 1))
            .floor();
  }

  /// median natural height of the ring just outside the pad, never flooded
  int _computePadHeight() {
    final ring = <int>[];
    const outer = padRadius + 3;
    for (var x = -outer; x <= outer; x++) {
      for (var z = -outer; z <= outer; z++) {
        final d = hypot(x.toDouble(), z.toDouble());
        if (d > padRadius && d <= outer) ring.add(naturalHeight(x, z));
      }
    }
    ring.sort();
    final median = ring[ring.length >> 1];
    return median > seaLevel + 2 ? median : seaLevel + 2;
  }
}
