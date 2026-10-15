using System.Collections.Generic;

namespace BlockSurvival.World
{
    /// The endless ground layer — twin of <c>server/resources/js/world/groundGen.ts</c>.
    /// Everything is a pure function of (seed, x, z).
    public static class GroundConst
    {
        public const int SeaLevel = 32;
        public const int GroundMin = 24;
        public const int GroundMax = 52;

        /// radius of the flat grass pad the player starts on
        public const int PadRadius = 8;

        /// blocks over which the pad eases into the natural terrain
        public const int PadBlend = 4;

        /// no water inside this radius of the origin
        public const int DryRadius = 16;
        public const double TreeDensity = 0.006;

        /// two trees are never within this Chebyshev distance of each other
        public const int TreeSpacing = 3;
        public const int TreeMinHeight = 4;
        public const int TreeMaxHeight = 6;
    }

    public delegate int HeightAt(int x, int z);

    public sealed class GroundModel
    {
        private const int SaltTree = 101;
        private const int SaltTreeHeight = 102;
        private const int SliceBroad = 11;
        private const int SliceDetail = 12;
        private const int SliceRidge = 13;

        public readonly long Seed;

        /// y of the spawn pad's top block
        public readonly int PadHeight;

        private readonly Fractal2 _n2;

        public GroundModel(long seed)
        {
            Seed = seed;
            _n2 = PerlinNoise.Fractal2Of(new PerlinNoise(seed ^ 0x5eed));
            PadHeight = ComputePadHeight();
        }

        private static int Clamp(int v, int lo, int hi) => v < lo ? lo : (v > hi ? hi : v);
        private static double Smoothstep(double t) => t * t * (3 - 2 * t);

        /// terrain height before the pad and dry zone are applied
        public int NaturalHeight(int x, int z)
        {
            var xd = (double)x;
            var zd = (double)z;
            var broad = _n2(xd, zd, Seed + SliceBroad, 0.011);
            var detail = _n2(xd, zd, Seed + SliceDetail, 0.045);
            var ridge = _n2(xd, zd, Seed + SliceRidge, 0.02);
            var h = 36 + 9 * broad + 2.5 * detail;
            // cliffs: a steep 9-block step where the ridge noise peaks
            if (ridge > 0.55)
            {
                var step = (ridge - 0.55) * 4;
                h += (step < 1 ? step : 1.0) * 9;
            }
            return Clamp((int)JsMath.JsRound(h), GroundConst.GroundMin, GroundConst.GroundMax);
        }

        /// height of the top block of a column
        public int Height(int x, int z)
        {
            var d = JsMath.Hypot(x, z);
            if (d <= GroundConst.PadRadius) return PadHeight;
            // keep the spawn area dry: the minimum height ramps down away from the origin
            var away = d - GroundConst.DryRadius;
            var floor = (int)System.Math.Ceiling(GroundConst.SeaLevel + 2 - (away > 0 ? away : 0.0));
            var natural = NaturalHeight(x, z);
            var nat = natural > floor ? natural : floor;
            if (d > GroundConst.PadRadius + GroundConst.PadBlend) return nat;
            var t = Smoothstep((d - GroundConst.PadRadius) / GroundConst.PadBlend);
            return (int)JsMath.JsRound(PadHeight + (nat - PadHeight) * t);
        }

        public static byte SurfaceFor(int h) => h <= GroundConst.SeaLevel + 1 ? Block.Sand : Block.Grass;

        /// Trunk height of the tree rooted at this column, or 0.
        public int TreeHeight(int x, int z, HeightAt heightAt)
        {
            var r = Noise.Hash01(Seed, x, z, SaltTree);
            if (r >= GroundConst.TreeDensity) return 0;
            if (SurfaceFor(heightAt(x, z)) != Block.Grass) return 0;
            if (JsMath.Hypot(x, z) <= GroundConst.PadRadius + GroundConst.PadBlend + 2) return 0;
            for (var dx = -2; dx <= 2; dx++)
            {
                for (var dz = -2; dz <= 2; dz++)
                {
                    if (heightAt(x + dx, z + dz) < GroundConst.SeaLevel) return 0;
                }
            }
            for (var dx = -GroundConst.TreeSpacing; dx <= GroundConst.TreeSpacing; dx++)
            {
                for (var dz = -GroundConst.TreeSpacing; dz <= GroundConst.TreeSpacing; dz++)
                {
                    if (dx == 0 && dz == 0) continue;
                    var r2 = Noise.Hash01(Seed, x + dx, z + dz, SaltTree);
                    if (r2 < GroundConst.TreeDensity &&
                        (r2 < r || (r2 == r && (dx < 0 || (dx == 0 && dz < 0)))))
                    {
                        return 0;
                    }
                }
            }
            return GroundConst.TreeMinHeight +
                   (int)(Noise.Hash01(Seed, x, z, SaltTreeHeight) *
                         (GroundConst.TreeMaxHeight - GroundConst.TreeMinHeight + 1));
        }

        /// median natural height of the ring just outside the pad, never flooded
        private int ComputePadHeight()
        {
            var ring = new List<int>();
            const int outer = GroundConst.PadRadius + 3;
            for (var x = -outer; x <= outer; x++)
            {
                for (var z = -outer; z <= outer; z++)
                {
                    var d = JsMath.Hypot(x, z);
                    if (d > GroundConst.PadRadius && d <= outer) ring.Add(NaturalHeight(x, z));
                }
            }
            ring.Sort();
            var median = ring[ring.Count >> 1];
            return median > GroundConst.SeaLevel + 2 ? median : GroundConst.SeaLevel + 2;
        }
    }
}
