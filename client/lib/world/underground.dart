/// What is under the ground (issue #25) — twin of
/// `server/resources/js/world/underground.ts`: caves to walk through and ore veins
/// to find in their walls.
///
/// Both halves are pure functions of (seed, x, y, z) like the rest of worldgen:
///
/// - **Caves** are the intersection of two Perlin fields. A single field thresholded
///   near zero gives sheets; two of them near zero at once gives the *line* where the
///   sheets cross, which reads as a winding tunnel.
/// - **Veins** are placed per cell, not per voxel: space is cut into [veinCell]³ cells
///   and each cell either holds one vein or does not, decided by a hash of the cell.
///   The vein's blocks come from a short random walk out of its centre, seeded by that
///   same hash, so a vein straddling a chunk border is built identically from either
///   side.
library;

import 'dart:typed_data';

import 'chunk.dart';
import 'js_math.dart';
import 'noise.dart';
import 'ores.dart';
import 'palette.dart';

// ---------------------------------------------------------------- caves
/// horizontal scale of the tunnel field; smaller = longer, lazier tunnels
const double _caveFreq = 0.035;

/// y is sampled faster than x/z, so tunnels run flatter than they climb
const double _caveSquash = 1.7;

/// tunnel half-width just under the roof, and at its widest deep down
const double _caveMinR = 0.05;
const double _caveMaxR = 0.105;

/// depth over which a tunnel opens out from min to max
const double _caveWidenOver = 24;

/// never break the surface: this many blocks of ground always stay above a tunnel
const int caveRoof = 5;

/// never touch bedrock or the layer resting on it
const int caveFloor = 2;

double _clamp01(double v) => v < 0
    ? 0
    : v > 1
    ? 1
    : v;

/// Where the tunnels are, for one world seed.
final class CaveModel {
  CaveModel(int seed, num padRadius)
    : _a = PerlinNoise(u32(seed ^ 0xca7e5)),
      _b = PerlinNoise(u32(seed ^ 0x7c0a1)),
      _padRadiusSq = padRadius * padRadius;

  final PerlinNoise _a;
  final PerlinNoise _b;

  /// no tunnel may come within this radius of the origin: the spawn pad stands on solid ground
  final num _padRadiusSq;

  /// True where the ground should be hollow. [h] is the surface height of the column.
  bool open(int x, int y, int z, int h) {
    if (y <= caveFloor || y > h - caveRoof) return false;
    if (x * x + z * z <= _padRadiusSq) return false;
    final fx = x * _caveFreq;
    final fy = y * _caveFreq * _caveSquash;
    final fz = z * _caveFreq;
    final na = _a.noise(fx, fy, fz);
    final nb = _b.noise(fx, fy, fz);
    final t = _clamp01((h - caveRoof - y) / _caveWidenOver);
    final r = _caveMinR + (_caveMaxR - _caveMinR) * t;
    return na * na + nb * nb < r * r;
  }
}

// ---------------------------------------------------------------- ore veins
/// space is cut into cells this big; each holds at most one vein
const int veinCell = 8;

/// a vein's blocks never leave this box around its centre
const int veinReach = 5;

const int _saltVein = 4001;

/// veins are memoised across the chunks that share them
const int _veinCache = 8192;

final int _bandMin = ores.map((o) => o.minY).reduce((a, b) => a < b ? a : b);
final int _bandMax = ores.map((o) => o.maxY).reduce((a, b) => a > b ? a : b);

final class Vein {
  const Vein(this.ore, this.x, this.y, this.z, this.offsets);

  final OreDef ore;

  /// centre, in world blocks
  final int x;
  final int y;
  final int z;

  /// the vein's blocks as offsets from the centre, flattened as x,y,z triples
  final Int8List offsets;
}

/// The ore veins of one world. The cache belongs to the field, not the library:
/// two worlds open at once must not read each other's veins.
final class VeinField {
  VeinField(this.seed);

  final int seed;
  final Map<String, Vein?> _cache = {};

  /// The vein held by one cell, or null. Everything about it — where its centre sits,
  /// which ore it is, how big, and the walk that shapes it — comes out of one seeded
  /// RNG, so it is the same vein whichever chunk asks for it.
  Vein? inCell(int gx, int gy, int gz) {
    if (gy * veinCell > _bandMax || gy * veinCell + veinCell - 1 < _bandMin) {
      return null;
    }
    final key = '$gx,$gy,$gz';
    if (_cache.containsKey(key)) return _cache[key];
    final rng = Rng(hashInt(u32(seed ^ _saltVein), gx, gy, gz));
    final x = gx * veinCell + rng.randint(0, veinCell - 1);
    final y = gy * veinCell + rng.randint(0, veinCell - 1);
    final z = gz * veinCell + rng.randint(0, veinCell - 1);
    final roll = rng.random();
    var acc = 0.0;
    OreDef? ore;
    for (final o in ores) {
      if (y < o.minY || y > o.maxY) continue;
      acc += o.chance;
      if (roll < acc) {
        ore = o;
        break;
      }
    }
    final vein = ore == null
        ? null
        : Vein(
            ore,
            x,
            y,
            z,
            _walk(rng, rng.randint(ore.sizeMin, ore.sizeMax)),
          );
    if (_cache.length >= _veinCache) _cache.remove(_cache.keys.first);
    _cache[key] = vein;
    return vein;
  }

  /// Every vein that can reach the block box [x0,x1] × [y0,y1] × [z0,z1], in cell order.
  List<Vein> near(int x0, int y0, int z0, int x1, int y1, int z1) {
    final out = <Vein>[];
    final gx1 = ((x1 + veinReach) / veinCell).floor();
    final gy1 = ((y1 + veinReach) / veinCell).floor();
    final gz1 = ((z1 + veinReach) / veinCell).floor();
    for (var gx = ((x0 - veinReach) / veinCell).floor(); gx <= gx1; gx++) {
      for (var gy = ((y0 - veinReach) / veinCell).floor(); gy <= gy1; gy++) {
        for (var gz = ((z0 - veinReach) / veinCell).floor(); gz <= gz1; gz++) {
          final v = inCell(gx, gy, gz);
          if (v != null) out.add(v);
        }
      }
    }
    return out;
  }
}

/// [count] blocks reached by stepping one axis at a time out of the centre, never
/// leaving the ±veinReach box. A step onto a block already taken is kept (the walk
/// goes on from there), which is what gives veins their clumped look.
Int8List _walk(Rng rng, int count) {
  final out = Int8List(count * 3);
  final seen = <int>{0};
  var x = 0;
  var y = 0;
  var z = 0;
  var n = 1;
  for (var guard = 0; n < count && guard < count * 8; guard++) {
    final axis = rng.randint(0, 2);
    final step = rng.randint(0, 1) * 2 - 1;
    final nx = x + (axis == 0 ? step : 0);
    final ny = y + (axis == 1 ? step : 0);
    final nz = z + (axis == 2 ? step : 0);
    if (nx.abs() > veinReach || ny.abs() > veinReach || nz.abs() > veinReach) {
      continue;
    }
    x = nx;
    y = ny;
    z = nz;
    final k = ((x + veinReach) << 8) | ((y + veinReach) << 4) | (z + veinReach);
    if (seen.contains(k)) continue;
    seen.add(k);
    out[n * 3] = x;
    out[n * 3 + 1] = y;
    out[n * 3 + 2] = z;
    n++;
  }
  return n == count ? out : Int8List.sublistView(out, 0, n * 3);
}

/// Write the veins into a chunk. Ore only ever replaces stone, so a vein is cut away
/// where a tunnel already went through it — which is exactly how a vein comes to be
/// showing in a cave wall — and never floats in the open or eats the soil above.
bool stampVeins(Uint8List data, List<Vein> veins, int x0, int y0, int z0) {
  var any = false;
  for (final v in veins) {
    final o = v.offsets;
    for (var i = 0; i < o.length; i += 3) {
      final lx = v.x + o[i] - x0;
      final ly = v.y + o[i + 1] - y0;
      final lz = v.z + o[i + 2] - z0;
      if (lx < 0 ||
          lx >= chunkSize ||
          ly < 0 ||
          ly >= chunkSize ||
          lz < 0 ||
          lz >= chunkSize) {
        continue;
      }
      final idx = localIndex(lx, ly, lz);
      if (data[idx] != Block.stone) continue;
      data[idx] = v.ore.block;
      any = true;
    }
  }
  return any;
}

/// true when a chunk's vertical band is entirely above every ore band
bool aboveAllVeins(int y0) => y0 > _bandMax + veinReach;
