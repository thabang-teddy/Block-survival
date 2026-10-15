using System.Collections.Generic;
using System.Linq;

namespace BlockSurvival.World
{
    /// What is under the ground (issue #25) — twin of
    /// <c>server/resources/js/world/underground.ts</c>: caves to walk through and
    /// ore veins to find in their walls.
    ///
    /// Both halves are pure functions of (seed, x, y, z) like the rest of worldgen:
    ///
    /// - <b>Caves</b> are the intersection of two Perlin fields. A single field
    ///   thresholded near zero gives sheets; two of them near zero at once gives
    ///   the <i>line</i> where the sheets cross, which reads as a winding tunnel.
    /// - <b>Veins</b> are placed per cell, not per voxel: space is cut into
    ///   <see cref="Underground.VeinCell"/>³ cells and each cell either holds one
    ///   vein or does not, decided by a hash of the cell. The vein's blocks come
    ///   from a short random walk out of its centre, seeded by that same hash, so a
    ///   vein straddling a chunk border is built identically from either side.
    public sealed class CaveModel
    {
        /// horizontal scale of the tunnel field; smaller = longer, lazier tunnels
        private const double CaveFreq = 0.035;

        /// y is sampled faster than x/z, so tunnels run flatter than they climb
        private const double CaveSquash = 1.7;

        /// tunnel half-width just under the roof, and at its widest deep down
        private const double CaveMinR = 0.05;
        private const double CaveMaxR = 0.105;

        /// depth over which a tunnel opens out from min to max
        private const double CaveWidenOver = 24;

        /// never break the surface: this many blocks of ground always stay above a tunnel
        public const int CaveRoof = 5;

        /// never touch bedrock or the layer resting on it
        private const int CaveFloor = 2;

        private readonly PerlinNoise _a;
        private readonly PerlinNoise _b;

        /// no tunnel may come within this radius of the origin: the spawn pad stands on solid ground
        private readonly double _padRadiusSq;

        public CaveModel(long seed, double padRadius)
        {
            _a = new PerlinNoise(JsMath.U32(seed ^ 0xca7e5));
            _b = new PerlinNoise(JsMath.U32(seed ^ 0x7c0a1));
            _padRadiusSq = padRadius * padRadius;
        }

        private static double Clamp01(double v) => v < 0 ? 0 : (v > 1 ? 1 : v);

        /// True where the ground should be hollow. <paramref name="h"/> is the surface height of the column.
        public bool Open(int x, int y, int z, int h)
        {
            if (y <= CaveFloor || y > h - CaveRoof) return false;
            if (x * (long)x + z * (long)z <= _padRadiusSq) return false;
            var fx = x * CaveFreq;
            var fy = y * CaveFreq * CaveSquash;
            var fz = z * CaveFreq;
            var na = _a.SampleNoise(fx, fy, fz);
            var nb = _b.SampleNoise(fx, fy, fz);
            var t = Clamp01((h - CaveRoof - y) / CaveWidenOver);
            var r = CaveMinR + (CaveMaxR - CaveMinR) * t;
            return na * na + nb * nb < r * r;
        }
    }

    public sealed class Vein
    {
        public readonly OreDef Ore;

        /// centre, in world blocks
        public readonly int X;
        public readonly int Y;
        public readonly int Z;

        /// the vein's blocks as offsets from the centre, flattened as x,y,z triples
        public readonly sbyte[] Offsets;

        public Vein(OreDef ore, int x, int y, int z, sbyte[] offsets)
        {
            Ore = ore;
            X = x;
            Y = y;
            Z = z;
            Offsets = offsets;
        }
    }

    /// The ore veins of one world. The cache belongs to the field, not the library:
    /// two worlds open at once must not read each other's veins.
    public sealed class VeinField
    {
        /// space is cut into cells this big; each holds at most one vein
        public const int VeinCell = 8;

        /// a vein's blocks never leave this box around its centre
        public const int VeinReach = 5;

        private const int SaltVein = 4001;

        /// veins are memoised across the chunks that share them
        private const int VeinCacheSize = 8192;

        private readonly long _seed;
        private readonly LruCache<(long, long, long), Vein> _cache = new LruCache<(long, long, long), Vein>(VeinCacheSize);

        public VeinField(long seed) => _seed = seed;

        /// The vein held by one cell, or null. Everything about it — where its centre
        /// sits, which ore it is, how big, and the walk that shapes it — comes out of
        /// one seeded RNG, so it is the same vein whichever chunk asks for it.
        public Vein InCell(long gx, long gy, long gz)
        {
            if (gy * VeinCell > Underground.BandMax || gy * VeinCell + VeinCell - 1 < Underground.BandMin) return null;
            return _cache.GetOrAdd((gx, gy, gz), () =>
            {
                var rng = new Rng(Noise.HashInt(JsMath.U32(_seed ^ SaltVein), gx, gy, gz));
                var x = gx * VeinCell + rng.RandInt(0, VeinCell - 1);
                var y = gy * VeinCell + rng.RandInt(0, VeinCell - 1);
                var z = gz * VeinCell + rng.RandInt(0, VeinCell - 1);
                var roll = rng.Random();
                var acc = 0.0;
                OreDef ore = null;
                foreach (var o in Ores.All)
                {
                    if (y < o.MinY || y > o.MaxY) continue;
                    acc += o.Chance;
                    if (roll < acc)
                    {
                        ore = o;
                        break;
                    }
                }
                if (ore == null) return null;
                return new Vein(ore, (int)x, (int)y, (int)z, Walk(rng, (int)rng.RandInt(ore.SizeMin, ore.SizeMax)));
            });
        }

        /// Every vein that can reach the block box [x0,x1] × [y0,y1] × [z0,z1], in cell order.
        public List<Vein> Near(long x0, long y0, long z0, long x1, long y1, long z1)
        {
            var outList = new List<Vein>();
            var gx1 = FloorDiv(x1 + VeinReach, VeinCell);
            var gy1 = FloorDiv(y1 + VeinReach, VeinCell);
            var gz1 = FloorDiv(z1 + VeinReach, VeinCell);
            for (var gx = FloorDiv(x0 - VeinReach, VeinCell); gx <= gx1; gx++)
            {
                for (var gy = FloorDiv(y0 - VeinReach, VeinCell); gy <= gy1; gy++)
                {
                    for (var gz = FloorDiv(z0 - VeinReach, VeinCell); gz <= gz1; gz++)
                    {
                        var v = InCell(gx, gy, gz);
                        if (v != null) outList.Add(v);
                    }
                }
            }
            return outList;
        }

        private static long FloorDiv(long v, long d) => (long)System.Math.Floor((double)v / d);

        /// [count] blocks reached by stepping one axis at a time out of the centre, never
        /// leaving the ±VeinReach box. A step onto a block already taken is kept (the walk
        /// goes on from there), which is what gives veins their clumped look.
        private static sbyte[] Walk(Rng rng, int count)
        {
            var outArr = new sbyte[count * 3];
            var seen = new HashSet<int> { 0 };
            int x = 0, y = 0, z = 0;
            var n = 1;
            for (var guard = 0; n < count && guard < count * 8; guard++)
            {
                var axis = (int)rng.RandInt(0, 2);
                var step = (int)rng.RandInt(0, 1) * 2 - 1;
                var nx = x + (axis == 0 ? step : 0);
                var ny = y + (axis == 1 ? step : 0);
                var nz = z + (axis == 2 ? step : 0);
                if (System.Math.Abs(nx) > VeinReach || System.Math.Abs(ny) > VeinReach || System.Math.Abs(nz) > VeinReach)
                {
                    continue;
                }
                x = nx;
                y = ny;
                z = nz;
                var k = ((x + VeinReach) << 8) | ((y + VeinReach) << 4) | (z + VeinReach);
                if (seen.Contains(k)) continue;
                seen.Add(k);
                outArr[n * 3] = (sbyte)x;
                outArr[n * 3 + 1] = (sbyte)y;
                outArr[n * 3 + 2] = (sbyte)z;
                n++;
            }
            return n == count ? outArr : outArr.Take(n * 3).ToArray();
        }
    }

    public static class Underground
    {
        public static readonly int BandMin = Ores.All.Min(o => o.MinY);
        public static readonly int BandMax = Ores.All.Max(o => o.MaxY);

        /// Write the veins into a chunk. Ore only ever replaces stone, so a vein is
        /// cut away where a tunnel already went through it — which is exactly how a
        /// vein comes to be showing in a cave wall — and never floats in the open or
        /// eats the soil above.
        public static bool StampVeins(byte[] data, List<Vein> veins, long x0, long y0, long z0)
        {
            var any = false;
            foreach (var v in veins)
            {
                var o = v.Offsets;
                for (var i = 0; i < o.Length; i += 3)
                {
                    var lx = v.X + o[i] - x0;
                    var ly = v.Y + o[i + 1] - y0;
                    var lz = v.Z + o[i + 2] - z0;
                    if (lx < 0 || lx >= Chunk.Size || ly < 0 || ly >= Chunk.Size || lz < 0 || lz >= Chunk.Size) continue;
                    var idx = Chunk.LocalIndex((int)lx, (int)ly, (int)lz);
                    if (data[idx] != Block.Stone) continue;
                    data[idx] = v.Ore.Block;
                    any = true;
                }
            }
            return any;
        }

        /// true when a chunk's vertical band is entirely above every ore band
        public static bool AboveAllVeins(long y0) => y0 > BandMax + VeinField.VeinReach;
    }
}
