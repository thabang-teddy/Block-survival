/// JavaScript number semantics the world generator depends on.
///
/// The browser client (`server/resources/js/world/*.ts`) and this port must
/// produce identical chunks for the same seed, so every operation whose result
/// could differ between V8 and the Dart VM is spelled out here rather than
/// mapped to the nearest `dart:math` call. Verified by
/// `shared/fixtures/worldgen/primitives.json`.
library;

import 'dart:math' as math;
import 'dart:typed_data';

/// `Math.PI`
const double jsPi = math.pi;

/// JS bitwise ops work on 32-bit values; Dart ints are 64-bit on native.
int u32(int x) => x & 0xFFFFFFFF;

/// `x | 0` — ToInt32.
int i32(int x) => (u32(x) ^ 0x80000000) - 0x80000000;

/// `Math.imul(a, b)` as an unsigned 32-bit value. The low 32 bits of the
/// product survive Dart's 64-bit wrap-around, and every caller masks anyway.
int imul(int a, int b) => u32(u32(a) * u32(b));

/// `x >>> n` on a 32-bit value.
int ushr(int x, int n) => u32(x) >> n;

/// `Math.round`: halfway cases go towards +∞ (Dart's `round()` goes away from zero).
int jsRound(double x) {
  final f = x.floorToDouble();
  return (x - f >= 0.5 ? f + 1 : f).toInt();
}

/// `Math.trunc` for finite input.
int jsTrunc(double x) => x.truncate();

/// `Math.hypot(x, z)` exactly as V8 computes it: scale by the larger magnitude,
/// Kahan-sum the squares, then `sqrt(sum) * max`. A plain `sqrt(x*x + z*z)` can
/// differ in the last bit, and the generator rounds these values.
double hypot(double x, double z) {
  final ax = x.abs();
  final az = z.abs();
  if (ax.isNaN || az.isNaN) return double.nan;
  final max = ax > az ? ax : az;
  if (max == double.infinity) return double.infinity;
  if (max == 0) return 0;
  var sum = 0.0;
  var compensation = 0.0;
  for (final v in [ax, az]) {
    final n = v / max;
    final summand = n * n - compensation;
    final preliminary = sum + summand;
    compensation = (preliminary - sum) - summand;
    sum = preliminary;
  }
  return math.sqrt(sum) * max;
}

// ---------------------------------------------------------------------------
// fdlibm sin / cos — the implementation behind V8's Math.sin / Math.cos
// (v8/src/base/ieee754.cc). Platform libms (MSVC CRT, glibc, bionic) are each
// within an ulp but not identical to one another, and the island generator
// rounds `cos(angle) * dist` to pick the lake position.
// ---------------------------------------------------------------------------

final ByteData _scratch = ByteData(8);

int _highWord(double x) {
  _scratch.setFloat64(0, x, Endian.little);
  return _scratch.getInt32(4, Endian.little);
}

double _fromWords(int high, int low) {
  _scratch.setInt32(4, high, Endian.little);
  _scratch.setUint32(0, low, Endian.little);
  return _scratch.getFloat64(0, Endian.little);
}

const double _s1 = -1.66666666666666324348e-01;
const double _s2 = 8.33333333332248946124e-03;
const double _s3 = -1.98412698298579493134e-04;
const double _s4 = 2.75573137070700676789e-06;
const double _s5 = -2.50507602534068634195e-08;
const double _s6 = 1.58969099521155010221e-10;

double _kernelSin(double x, double y, bool iy) {
  final ix = _highWord(x) & 0x7fffffff;
  if (ix < 0x3e400000) {
    if (x.toInt() == 0) return x;
  }
  final z = x * x;
  final v = z * x;
  final r = _s2 + z * (_s3 + z * (_s4 + z * (_s5 + z * _s6)));
  if (!iy) return x + v * (_s1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * _s1);
}

const double _c1 = 4.16666666666666019037e-02;
const double _c2 = -1.38888888888741095749e-03;
const double _c3 = 2.48015872894767294178e-05;
const double _c4 = -2.75573143513906633035e-07;
const double _c5 = 2.08757232129817482790e-09;
const double _c6 = -1.13596475577881948265e-11;

double _kernelCos(double x, double y) {
  final ix = _highWord(x) & 0x7fffffff;
  if (ix < 0x3e400000) {
    if (x.toInt() == 0) return 1.0;
  }
  final z = x * x;
  final r = z * (_c1 + z * (_c2 + z * (_c3 + z * (_c4 + z * (_c5 + z * _c6)))));
  if (ix < 0x3FD33333) return 1.0 - (0.5 * z - (z * r - x * y));
  final qx = ix > 0x3fe90000 ? 0.28125 : _fromWords(ix - 0x00200000, 0);
  final hz = 0.5 * z - qx;
  final a = 1.0 - qx;
  return a - (hz - (z * r - x * y));
}

const List<int> _npio2Hw = [
  0x3FF921FB,
  0x400921FB,
  0x4012D97C,
  0x401921FB,
  0x401F6A7A,
  0x4022D97C,
  0x4025FDBB,
  0x402921FB,
  0x402C463A,
  0x402F6A7A,
  0x4031475C,
  0x4032D97C,
  0x40346B9C,
  0x4035FDBB,
  0x40378FDB,
  0x403921FB,
  0x403AB41B,
  0x403C463A,
  0x403DD85A,
  0x403F6A7A,
  0x40407E4C,
  0x4041475C,
  0x4042106C,
  0x4042D97C,
  0x4043A28C,
  0x40446B9C,
  0x404534AC,
  0x4045FDBB,
  0x4046C6CB,
  0x40478FDB,
  0x404858EB,
  0x404921FB,
];

const double _invpio2 = 6.36619772367581382433e-01;
const double _pio2_1 = 1.57079632673412561417e+00;
const double _pio2_1t = 6.07710050650619224932e-11;
const double _pio2_2 = 6.07710050630396597660e-11;
const double _pio2_2t = 2.02226624879595063154e-21;
const double _pio2_3 = 2.02226624871116645580e-21;
const double _pio2_3t = 8.47842766036889956997e-32;

/// `__ieee754_rem_pio2` for |x| up to 2^19·π/2, which covers every angle the
/// generator produces (they are all in [0, 2π)). Returns n; y[0], y[1] = x mod π/2.
int _remPio2(double x, Float64List y) {
  final hx = _highWord(x);
  final ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    y[0] = x;
    y[1] = 0;
    return 0;
  }
  if (ix < 0x4002d97c) {
    if (hx > 0) {
      var z = x - _pio2_1;
      if (ix != 0x3ff921fb) {
        y[0] = z - _pio2_1t;
        y[1] = (z - y[0]) - _pio2_1t;
      } else {
        z -= _pio2_2;
        y[0] = z - _pio2_2t;
        y[1] = (z - y[0]) - _pio2_2t;
      }
      return 1;
    }
    var z = x + _pio2_1;
    if (ix != 0x3ff921fb) {
      y[0] = z + _pio2_1t;
      y[1] = (z - y[0]) + _pio2_1t;
    } else {
      z += _pio2_2;
      y[0] = z + _pio2_2t;
      y[1] = (z - y[0]) + _pio2_2t;
    }
    return -1;
  }
  if (ix > 0x413921fb) {
    throw ArgumentError.value(
      x,
      'x',
      'fdlibm port only covers |x| <= 2^19 * pi/2',
    );
  }
  var t = x.abs();
  final n = (t * _invpio2 + 0.5).toInt();
  final fn = n.toDouble();
  var r = t - fn * _pio2_1;
  var w = fn * _pio2_1t;
  if (n < 32 && ix != _npio2Hw[n - 1]) {
    y[0] = r - w;
  } else {
    final j = ix >> 20;
    y[0] = r - w;
    var i = j - ((_highWord(y[0]) >> 20) & 0x7ff);
    if (i > 16) {
      t = r;
      w = fn * _pio2_2;
      r = t - w;
      w = fn * _pio2_2t - ((t - r) - w);
      y[0] = r - w;
      i = j - ((_highWord(y[0]) >> 20) & 0x7ff);
      if (i > 49) {
        t = r;
        w = fn * _pio2_3;
        r = t - w;
        w = fn * _pio2_3t - ((t - r) - w);
        y[0] = r - w;
      }
    }
  }
  y[1] = (r - y[0]) - w;
  if (hx < 0) {
    y[0] = -y[0];
    y[1] = -y[1];
    return -n;
  }
  return n;
}

/// `Math.sin` as V8 computes it.
double jsSin(double x) {
  final ix = _highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return _kernelSin(x, 0, false);
  if (ix >= 0x7ff00000) return x - x;
  final y = Float64List(2);
  final n = _remPio2(x, y);
  switch (n & 3) {
    case 0:
      return _kernelSin(y[0], y[1], true);
    case 1:
      return _kernelCos(y[0], y[1]);
    case 2:
      return -_kernelSin(y[0], y[1], true);
    default:
      return -_kernelCos(y[0], y[1]);
  }
}

/// `Math.cos` as V8 computes it.
double jsCos(double x) {
  final ix = _highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return _kernelCos(x, 0);
  if (ix >= 0x7ff00000) return x - x;
  final y = Float64List(2);
  final n = _remPio2(x, y);
  switch (n & 3) {
    case 0:
      return _kernelCos(y[0], y[1]);
    case 1:
      return -_kernelSin(y[0], y[1], true);
    case 2:
      return -_kernelCos(y[0], y[1]);
    default:
      return _kernelSin(y[0], y[1], true);
  }
}
