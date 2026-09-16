/// Seeded PRNG + 3-D Perlin noise — twin of `server/resources/js/world/noise.ts`.
/// Integer arithmetic is done on unsigned 32-bit values (see js_math.dart).
library;

import 'dart:typed_data';

import 'js_math.dart';

/// mulberry32; returns doubles in [0, 1)
typedef RandomFn = double Function();

RandomFn createRng(int seed) {
  var a = u32(seed);
  return () {
    a = u32(a + 0x6d2b79f5);
    var t = a;
    t = imul(t ^ ushr(t, 15), t | 1);
    t ^= t + imul(t ^ ushr(t, 7), t | 61);
    return u32(t ^ ushr(t, 14)) / 4294967296;
  };
}

final class Rng {
  Rng(int seed) : _next = createRng(seed);

  final RandomFn _next;

  double random() => _next();

  /// inclusive on both ends, like Python's randint
  int randint(int lo, int hi) => lo + (_next() * (hi - lo + 1)).floor();

  List<T> shuffle<T>(List<T> arr) {
    final out = List<T>.of(arr);
    for (var i = out.length - 1; i > 0; i--) {
      final j = (_next() * (i + 1)).floor();
      final tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }
}

/// Deterministic 32-bit hash of up to four ints (murmur3-style finaliser).
int hashInt(int a, [int b = 0, int c = 0, int d = 0]) {
  var h = imul(a, 0x9e3779b1) ^ 0x85ebca6b;
  h = imul(h ^ ushr(h, 15), 0x2c1b3c6d) ^ imul(b, 0x27d4eb2f);
  h = imul(h ^ ushr(h, 13), 0x165667b1) ^ imul(c, 0x9e3779b1);
  h = imul(h ^ ushr(h, 16), 0x85ebca6b) ^ imul(d, 0xc2b2ae35);
  h ^= ushr(h, 13);
  h = imul(h, 0x27d4eb2f);
  return u32(h ^ ushr(h, 16));
}

/// hashInt scaled to [0, 1)
double hash01(int a, [int b = 0, int c = 0, int d = 0]) =>
    hashInt(a, b, c, d) / 4294967296;

const List<List<int>> _grad = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
];

double _fade(double t) => t * t * t * (t * (t * 6 - 15) + 10);
double _lerp(double a, double b, double t) => a + t * (b - a);

/// Improved Perlin noise with a seeded permutation table. Output ≈ -1..1.
final class PerlinNoise {
  PerlinNoise(int seed) {
    final p = Uint8List(256);
    for (var i = 0; i < 256; i++) {
      p[i] = i;
    }
    final rng = createRng(seed);
    for (var i = 255; i > 0; i--) {
      final j = (rng() * (i + 1)).floor();
      final tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (var i = 0; i < 512; i++) {
      _perm[i] = p[i & 255];
    }
  }

  final Uint8List _perm = Uint8List(512);

  double _gradAt(int hash, double x, double y, double z) {
    final g = _grad[hash % 12];
    return g[0] * x + g[1] * y + g[2] * z;
  }

  double noise(double x, double y, double z) {
    final fx = x.floorToDouble();
    final fy = y.floorToDouble();
    final fz = z.floorToDouble();
    final xi = fx.toInt() & 255;
    final yi = fy.toInt() & 255;
    final zi = fz.toInt() & 255;
    x -= fx;
    y -= fy;
    z -= fz;
    final u = _fade(x);
    final v = _fade(y);
    final w = _fade(z);
    final p = _perm;
    final a = p[xi] + yi;
    final aa = p[a] + zi;
    final ab = p[a + 1] + zi;
    final b = p[xi + 1] + yi;
    final ba = p[b] + zi;
    final bb = p[b + 1] + zi;
    return _lerp(
      _lerp(
        _lerp(_gradAt(p[aa], x, y, z), _gradAt(p[ba], x - 1, y, z), u),
        _lerp(_gradAt(p[ab], x, y - 1, z), _gradAt(p[bb], x - 1, y - 1, z), u),
        v,
      ),
      _lerp(
        _lerp(
          _gradAt(p[aa + 1], x, y, z - 1),
          _gradAt(p[ba + 1], x - 1, y, z - 1),
          u,
        ),
        _lerp(
          _gradAt(p[ab + 1], x, y - 1, z - 1),
          _gradAt(p[bb + 1], x - 1, y - 1, z - 1),
          u,
        ),
        v,
      ),
      w,
    );
  }
}

/// 2-D fractal noise in roughly -1.5..1.5; `seed` picks a slice
typedef Fractal2 = double Function(
  double x,
  double z,
  double seed,
  double freq,
);

Fractal2 fractal2(PerlinNoise perlin) {
  return (x, z, seed, freq) {
    final vx = x * freq;
    final vz = z * freq;
    final vs = seed * 7.31;
    return perlin.noise(vx, vz, vs) +
        0.5 * perlin.noise(vx * 2.1 + 3.3, vz * 2.1 + 1.7, vs * 2.1);
  };
}
