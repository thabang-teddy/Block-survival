using System.Collections.Generic;

namespace BlockSurvival.World
{
    /// <summary>
    /// Seeded PRNG + 3-D Perlin noise — twin of <c>server/resources/js/world/noise.ts</c>.
    /// Integer arithmetic is done on unsigned 32-bit values (see <see cref="JsMath"/>).
    /// </summary>
    public delegate double RandomFn();

    public static class Noise
    {
        /// mulberry32; returns doubles in [0, 1)
        public static RandomFn CreateRng(long seed)
        {
            var a = JsMath.U32(seed);
            return () =>
            {
                a = JsMath.U32(a + 0x6d2b79f5L);
                var t = a;
                t = JsMath.Imul(t ^ JsMath.Ushr(t, 15), t | 1);
                t ^= t + JsMath.Imul(t ^ JsMath.Ushr(t, 7), t | 61);
                return JsMath.U32(t ^ JsMath.Ushr(t, 14)) / 4294967296.0;
            };
        }

        /// Deterministic 32-bit hash of up to four ints (murmur3-style finaliser).
        public static long HashInt(long a, long b = 0, long c = 0, long d = 0)
        {
            var h = JsMath.Imul(a, 0x9e3779b1L) ^ 0x85ebca6bL;
            h = JsMath.Imul(h ^ JsMath.Ushr(h, 15), 0x2c1b3c6dL) ^ JsMath.Imul(b, 0x27d4eb2fL);
            h = JsMath.Imul(h ^ JsMath.Ushr(h, 13), 0x165667b1L) ^ JsMath.Imul(c, 0x9e3779b1L);
            h = JsMath.Imul(h ^ JsMath.Ushr(h, 16), 0x85ebca6bL) ^ JsMath.Imul(d, 0xc2b2ae35L);
            h ^= JsMath.Ushr(h, 13);
            h = JsMath.Imul(h, 0x27d4eb2fL);
            return JsMath.U32(h ^ JsMath.Ushr(h, 16));
        }

        /// hashInt scaled to [0, 1)
        public static double Hash01(long a, long b = 0, long c = 0, long d = 0) =>
            HashInt(a, b, c, d) / 4294967296.0;
    }

    public sealed class Rng
    {
        private readonly RandomFn _next;

        public Rng(long seed) => _next = Noise.CreateRng(seed);

        public double Random() => _next();

        /// inclusive on both ends, like Python's randint
        public long RandInt(long lo, long hi) => lo + (long)(_next() * (hi - lo + 1));

        public List<T> Shuffle<T>(IReadOnlyList<T> arr)
        {
            var outList = new List<T>(arr);
            for (var i = outList.Count - 1; i > 0; i--)
            {
                var j = (int)(_next() * (i + 1));
                (outList[i], outList[j]) = (outList[j], outList[i]);
            }
            return outList;
        }
    }

    /// 2-D fractal noise in roughly -1.5..1.5; <c>seed</c> picks a slice
    public delegate double Fractal2(double x, double z, double seed, double freq);

    /// Improved Perlin noise with a seeded permutation table. Output ≈ -1..1.
    public sealed class PerlinNoise
    {
        private static readonly int[][] Grad =
        {
            new[] { 1, 1, 0 }, new[] { -1, 1, 0 }, new[] { 1, -1, 0 }, new[] { -1, -1, 0 },
            new[] { 1, 0, 1 }, new[] { -1, 0, 1 }, new[] { 1, 0, -1 }, new[] { -1, 0, -1 },
            new[] { 0, 1, 1 }, new[] { 0, -1, 1 }, new[] { 0, 1, -1 }, new[] { 0, -1, -1 },
        };

        private readonly byte[] _perm = new byte[512];

        public PerlinNoise(long seed)
        {
            var p = new byte[256];
            for (var i = 0; i < 256; i++) p[i] = (byte)i;
            var rng = Noise.CreateRng(seed);
            for (var i = 255; i > 0; i--)
            {
                var j = (int)(rng() * (i + 1));
                (p[i], p[j]) = (p[j], p[i]);
            }
            for (var i = 0; i < 512; i++) _perm[i] = p[i & 255];
        }

        private static double Fade(double t) => t * t * t * (t * (t * 6 - 15) + 10);
        private static double Lerp(double a, double b, double t) => a + t * (b - a);

        private double GradAt(int hash, double x, double y, double z)
        {
            var g = Grad[hash % 12];
            return g[0] * x + g[1] * y + g[2] * z;
        }

        public double SampleNoise(double x, double y, double z)
        {
            var fx = System.Math.Floor(x);
            var fy = System.Math.Floor(y);
            var fz = System.Math.Floor(z);
            // fx/fy/fz can be far larger than int32 (fractal2's z-slice is seed*7.31), so
            // truncate through `long` first — Dart's `int` is 64-bit and never overflows here.
            var xi = (int)((long)fx & 255);
            var yi = (int)((long)fy & 255);
            var zi = (int)((long)fz & 255);
            x -= fx;
            y -= fy;
            z -= fz;
            var u = Fade(x);
            var v = Fade(y);
            var w = Fade(z);
            var p = _perm;
            var a = p[xi] + yi;
            var aa = p[a] + zi;
            var ab = p[a + 1] + zi;
            var b = p[xi + 1] + yi;
            var ba = p[b] + zi;
            var bb = p[b + 1] + zi;
            return Lerp(
                Lerp(
                    Lerp(GradAt(p[aa], x, y, z), GradAt(p[ba], x - 1, y, z), u),
                    Lerp(GradAt(p[ab], x, y - 1, z), GradAt(p[bb], x - 1, y - 1, z), u),
                    v),
                Lerp(
                    Lerp(GradAt(p[aa + 1], x, y, z - 1), GradAt(p[ba + 1], x - 1, y, z - 1), u),
                    Lerp(GradAt(p[ab + 1], x, y - 1, z - 1), GradAt(p[bb + 1], x - 1, y - 1, z - 1), u),
                    v),
                w);
        }

        public static Fractal2 Fractal2Of(PerlinNoise perlin)
        {
            return (x, z, seed, freq) =>
            {
                var vx = x * freq;
                var vz = z * freq;
                var vs = seed * 7.31;
                return perlin.SampleNoise(vx, vz, vs) +
                       0.5 * perlin.SampleNoise(vx * 2.1 + 3.3, vz * 2.1 + 1.7, vs * 2.1);
            };
        }
    }
}
