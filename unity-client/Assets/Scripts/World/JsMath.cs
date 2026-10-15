using System;

namespace BlockSurvival.World
{
    /// <summary>
    /// JavaScript number semantics the world generator depends on.
    ///
    /// The browser client (<c>server/resources/js/world/*.ts</c>) and every port
    /// (Dart in <c>client/lib/world/js_math.dart</c>, this one) must produce
    /// identical chunks for the same seed, so every operation whose result could
    /// differ between V8, the Dart VM and the CLR is spelled out here rather than
    /// mapped to the nearest <see cref="Math"/> call. Verified by
    /// <c>shared/fixtures/worldgen/primitives.json</c>.
    /// </summary>
    public static class JsMath
    {
        public const double Pi = Math.PI;

        /// JS bitwise ops work on 32-bit values; this keeps the intermediate as a
        /// non-negative 64-bit value so later shifts behave like unsigned 32-bit ones.
        public static long U32(long x) => x & 0xFFFFFFFFL;

        /// <c>x | 0</c> — ToInt32.
        public static int I32(long x) => unchecked((int)(uint)U32(x));

        /// <c>Math.imul(a, b)</c> as an unsigned 32-bit value.
        public static long Imul(long a, long b) => U32(U32(a) * U32(b));

        /// <c>x &gt;&gt;&gt; n</c> on a 32-bit value.
        public static long Ushr(long x, int n) => U32(x) >> n;

        /// <c>Math.round</c>: halfway cases go towards +∞ (C#'s <see cref="Math.Round"/>
        /// defaults to banker's rounding).
        public static long JsRound(double x)
        {
            double f = Math.Floor(x);
            return (long)(x - f >= 0.5 ? f + 1 : f);
        }

        /// <c>Math.trunc</c> for finite input.
        public static long JsTrunc(double x) => (long)x;

        /// <c>Math.hypot(x, z)</c> exactly as V8 computes it: scale by the largest
        /// magnitude, Kahan-sum the squares, then <c>sqrt(sum) * max</c>. A plain
        /// <c>sqrt(x*x + z*z)</c> can differ in the last bit, and the generator
        /// rounds these values.
        public static double Hypot(double x, double z) => HypotN(x, z);

        /// three-argument form (raycast direction length)
        public static double Hypot3(double x, double y, double z) => HypotN(x, y, z);

        public static double HypotN(params double[] values)
        {
            var max = 0.0;
            var anyNaN = false;
            var abs = new double[values.Length];
            for (var i = 0; i < values.Length; i++)
            {
                var v = values[i];
                if (double.IsNaN(v))
                {
                    anyNaN = true;
                    continue;
                }
                var a = Math.Abs(v);
                abs[i] = a;
                if (a > max) max = a;
            }
            if (double.IsPositiveInfinity(max)) return double.PositiveInfinity;
            if (anyNaN) return double.NaN;
            if (max == 0) return 0;
            var sum = 0.0;
            var compensation = 0.0;
            foreach (var a in abs)
            {
                var n = a / max;
                var summand = n * n - compensation;
                var preliminary = sum + summand;
                compensation = (preliminary - sum) - summand;
                sum = preliminary;
            }
            return Math.Sqrt(sum) * max;
        }

        /// for finite doubles (-1, 0 or 1; 0 stays 0)
        public static double JsSign(double x) => x > 0 ? 1 : (x < 0 ? -1 : 0);

        // -----------------------------------------------------------------
        // fdlibm sin / cos — the implementation behind V8's Math.sin / Math.cos
        // (v8/src/base/ieee754.cc). Platform libms (MSVC CRT, glibc, bionic) are
        // each within an ulp but not identical to one another, and the island
        // generator rounds `cos(angle) * dist` to pick the lake position.
        // -----------------------------------------------------------------

        private static long HighWord(double x) => BitConverter.DoubleToInt64Bits(x) >> 32;

        private static double FromWords(long high, long low)
        {
            var bits = (U32(high) << 32) | U32(low);
            return BitConverter.Int64BitsToDouble(bits);
        }

        private const double S1 = -1.66666666666666324348e-01;
        private const double S2 = 8.33333333332248946124e-03;
        private const double S3 = -1.98412698298579493134e-04;
        private const double S4 = 2.75573137070700676789e-06;
        private const double S5 = -2.50507602534068634195e-08;
        private const double S6 = 1.58969099521155010221e-10;

        private static double KernelSin(double x, double y, bool iy)
        {
            var ix = HighWord(x) & 0x7fffffffL;
            if (ix < 0x3e400000L)
            {
                if ((long)x == 0) return x;
            }
            var z = x * x;
            var v = z * x;
            var r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
            if (!iy) return x + v * (S1 + z * r);
            return x - ((z * (0.5 * y - v * r) - y) - v * S1);
        }

        private const double C1 = 4.16666666666666019037e-02;
        private const double C2 = -1.38888888888741095749e-03;
        private const double C3 = 2.48015872894767294178e-05;
        private const double C4 = -2.75573143513906633035e-07;
        private const double C5 = 2.08757232129817482790e-09;
        private const double C6 = -1.13596475577881948265e-11;

        private static double KernelCos(double x, double y)
        {
            var ix = HighWord(x) & 0x7fffffffL;
            if (ix < 0x3e400000L)
            {
                if ((long)x == 0) return 1.0;
            }
            var z = x * x;
            var r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
            if (ix < 0x3FD33333L) return 1.0 - (0.5 * z - (z * r - x * y));
            var qx = ix > 0x3fe90000L ? 0.28125 : FromWords(ix - 0x00200000L, 0);
            var hz = 0.5 * z - qx;
            var a = 1.0 - qx;
            return a - (hz - (z * r - x * y));
        }

        private static readonly long[] NPio2Hw =
        {
            0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C,
            0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C,
            0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A,
            0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
            0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
            0x404858EB, 0x404921FB,
        };

        private const double InvPio2 = 6.36619772367581382433e-01;
        private const double Pio2_1 = 1.57079632673412561417e+00;
        private const double Pio2_1t = 6.07710050650619224932e-11;
        private const double Pio2_2 = 6.07710050630396597660e-11;
        private const double Pio2_2t = 2.02226624879595063154e-21;
        private const double Pio2_3 = 2.02226624871116645580e-21;
        private const double Pio2_3t = 8.47842766036889956997e-32;

        /// <c>__ieee754_rem_pio2</c> for |x| up to 2^19·π/2, which covers every angle
        /// the generator produces (they are all in [0, 2π)). Returns n; y[0], y[1] =
        /// x mod π/2.
        private static long RemPio2(double x, double[] y)
        {
            var hx = HighWord(x);
            var ix = hx & 0x7fffffffL;
            if (ix <= 0x3fe921fbL)
            {
                y[0] = x;
                y[1] = 0;
                return 0;
            }
            if (ix < 0x4002d97cL)
            {
                if (hx > 0)
                {
                    var z = x - Pio2_1;
                    if (ix != 0x3ff921fbL)
                    {
                        y[0] = z - Pio2_1t;
                        y[1] = (z - y[0]) - Pio2_1t;
                    }
                    else
                    {
                        z -= Pio2_2;
                        y[0] = z - Pio2_2t;
                        y[1] = (z - y[0]) - Pio2_2t;
                    }
                    return 1;
                }
                var z2 = x + Pio2_1;
                if (ix != 0x3ff921fbL)
                {
                    y[0] = z2 + Pio2_1t;
                    y[1] = (z2 - y[0]) + Pio2_1t;
                }
                else
                {
                    z2 += Pio2_2;
                    y[0] = z2 + Pio2_2t;
                    y[1] = (z2 - y[0]) + Pio2_2t;
                }
                return -1;
            }
            if (ix > 0x413921fbL)
            {
                throw new ArgumentOutOfRangeException(nameof(x), "fdlibm port only covers |x| <= 2^19 * pi/2");
            }
            var t = Math.Abs(x);
            var n = (long)(t * InvPio2 + 0.5);
            var fn = (double)n;
            var r = t - fn * Pio2_1;
            var w = fn * Pio2_1t;
            if (n < 32 && ix != NPio2Hw[n - 1])
            {
                y[0] = r - w;
            }
            else
            {
                var j = ix >> 20;
                y[0] = r - w;
                var i = j - ((HighWord(y[0]) >> 20) & 0x7ffL);
                if (i > 16)
                {
                    t = r;
                    w = fn * Pio2_2;
                    r = t - w;
                    w = fn * Pio2_2t - ((t - r) - w);
                    y[0] = r - w;
                    i = j - ((HighWord(y[0]) >> 20) & 0x7ffL);
                    if (i > 49)
                    {
                        t = r;
                        w = fn * Pio2_3;
                        r = t - w;
                        w = fn * Pio2_3t - ((t - r) - w);
                        y[0] = r - w;
                    }
                }
            }
            y[1] = (r - y[0]) - w;
            if (hx < 0)
            {
                y[0] = -y[0];
                y[1] = -y[1];
                return -n;
            }
            return n;
        }

        /// <c>Math.sin</c> as V8 computes it.
        public static double JsSin(double x)
        {
            var ix = HighWord(x) & 0x7fffffffL;
            if (ix <= 0x3fe921fbL) return KernelSin(x, 0, false);
            if (ix >= 0x7ff00000L) return x - x;
            var y = new double[2];
            var n = RemPio2(x, y);
            switch (n & 3)
            {
                case 0: return KernelSin(y[0], y[1], true);
                case 1: return KernelCos(y[0], y[1]);
                case 2: return -KernelSin(y[0], y[1], true);
                default: return -KernelCos(y[0], y[1]);
            }
        }

        /// <c>Math.cos</c> as V8 computes it.
        public static double JsCos(double x)
        {
            var ix = HighWord(x) & 0x7fffffffL;
            if (ix <= 0x3fe921fbL) return KernelCos(x, 0);
            if (ix >= 0x7ff00000L) return x - x;
            var y = new double[2];
            var n = RemPio2(x, y);
            switch (n & 3)
            {
                case 0: return KernelCos(y[0], y[1]);
                case 1: return -KernelSin(y[0], y[1], true);
                case 2: return -KernelCos(y[0], y[1]);
                default: return KernelSin(y[0], y[1], true);
            }
        }
    }
}
