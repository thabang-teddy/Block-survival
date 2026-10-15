using System.Collections.Generic;
using System.Linq;

namespace BlockSurvival.World
{
    /// where generated voxels go: a template that is stamped into chunks later
    public interface IVoxelSink
    {
        byte GetBlock(int x, int y, int z);
        void SetBlock(int x, int y, int z, byte id);
        void SetBlockIfAir(int x, int y, int z, byte id);
    }

    public sealed class IslandParams
    {
        public readonly int Size;
        public readonly long Seed;
        public readonly int MaxHeight;
        public readonly int Depth;
        public readonly int PadRadius;
        public readonly bool Lake;
        public readonly double TreeDensity;

        public IslandParams(int size, long seed, int maxHeight, int depth, int padRadius, bool lake, double treeDensity)
        {
            Size = size;
            Seed = seed;
            MaxHeight = maxHeight;
            Depth = depth;
            PadRadius = padRadius;
            Lake = lake;
            TreeDensity = treeDensity;
        }
    }

    public readonly struct IslandInfo
    {
        /// y of the pad's top block
        public readonly int PadHeight;
        public readonly int VoxelCount;

        public IslandInfo(int padHeight, int voxelCount)
        {
            PadHeight = padHeight;
            VoxelCount = voxelCount;
        }
    }

    /// Floating voxel island — twin of <c>server/resources/js/world/islandGen.ts</c>
    /// (itself a port of <c>Design/blender_scripts/islands.py</c> <c>generate_island</c>).
    ///
    /// Origin = island centre, y = 0 is the lowest grass layer, the island hangs below.
    public static class IslandGen
    {
        /// Island_Large from islands.py — the legacy island over the spawn pad
        public static readonly IslandParams IslandLarge = new IslandParams(
            size: 56, seed: 11, maxHeight: 9, depth: 16, padRadius: 8, lake: true, treeDensity: 0.022);

        public static readonly IslandParams IslandMedium = new IslandParams(
            size: 32, seed: 7, maxHeight: 6, depth: 11, padRadius: 5, lake: true, treeDensity: 0.022);

        private sealed class Column
        {
            public readonly int X;
            public readonly int Z;
            public int H;
            public readonly int Dep;

            public Column(int x, int z, int h, int dep)
            {
                X = x;
                Z = z;
                H = h;
                Dep = dep;
            }
        }

        private static long ColKey(int x, int z) => (long)(x + 512) * 1024 + (z + 512);

        private static void AddTree(IVoxelSink world, int x, int y, int z, Rng rng)
        {
            var height = (int)rng.RandInt(4, 6);
            for (var dy = 0; dy < height; dy++) world.SetBlock(x, y + dy, z, Block.Log);
            var top = y + height;
            for (var dy = -2; dy < 2; dy++)
            {
                var r = dy < 0 ? 2 : 1;
                for (var dx = -r; dx <= r; dx++)
                {
                    for (var dz = -r; dz <= r; dz++)
                    {
                        if (System.Math.Abs(dx) == r && System.Math.Abs(dz) == r && dy != -1) continue;
                        world.SetBlockIfAir(x + dx, top + dy, z + dz, Block.Leaves);
                    }
                }
            }
            world.SetBlock(x, top + 2, z, Block.Leaves);
        }

        public static IslandInfo GenerateIsland(IVoxelSink world, IslandParams p)
        {
            var size = p.Size;
            var seed = p.Seed;
            var maxHeight = p.MaxHeight;
            var depth = p.Depth;
            var padRadius = p.PadRadius;
            var rng = new Rng(seed);
            var n2 = PerlinNoise.Fractal2Of(new PerlinNoise(seed));
            var bigR = size / 2.0;
            var ri = (int)JsMath.JsTrunc(bigR);
            var seedD = (double)seed;

            // ---- heightmap + island mask (insertion order matters: the RNG is consumed in it)
            var heights = new Dictionary<long, Column>();
            var order = new List<long>();
            for (var x = -ri - 1; x <= ri + 1; x++)
            {
                for (var z = -ri - 1; z <= ri + 1; z++)
                {
                    var xd = (double)x;
                    var zd = (double)z;
                    var d = JsMath.Hypot(xd, zd) / bigR;
                    var mask = 1 - d + 0.3 * n2(xd, zd, seedD, 0.09);
                    if (mask <= 0.12) continue;
                    var hRaw = mask * maxHeight + 2 * n2(xd, zd, seedD + 1, 0.16);
                    var h = mask > 0.5
                        ? JsMath.JsRound(hRaw / 2) * 2
                        : JsMath.JsRound(hRaw); // terraces inland
                    h = h < 0 ? 0 : (h > maxHeight + 2 ? maxHeight + 2 : h);
                    var dep = JsMath.JsTrunc(mask * depth + 2 * n2(xd, zd, seedD + 2, 0.13) * mask);
                    dep = dep < 1 ? 1 : dep;
                    var key = ColKey(x, z);
                    heights[key] = new Column(x, z, (int)h, (int)dep);
                    order.Add(key);
                }
            }

            IEnumerable<Column> Cols() => order.Select(k => heights[k]);

            // ---- build pad: flat, at the height of the surrounding terrain
            var padHeight = 2;
            if (padRadius != 0)
            {
                var ring = new List<int>();
                foreach (var c in Cols())
                {
                    var dist = JsMath.Hypot(c.X, c.Z);
                    if (dist > padRadius && dist <= padRadius + 3) ring.Add(c.H);
                }
                if (ring.Count > 0)
                {
                    ring.Sort();
                    padHeight = (int)JsMath.JsRound(ring[ring.Count >> 1] / 2.0) * 2; // median, snapped to a terrace
                }
                foreach (var c in Cols())
                {
                    if (JsMath.Hypot(c.X, c.Z) <= padRadius) c.H = padHeight;
                }
            }

            // ---- lake: pick a spot on a ring that clears the pad
            var lakeCells = new HashSet<long>();
            var lakeLevel = 0;
            if (p.Lake)
            {
                var lrRaw = (int)JsMath.JsTrunc(size / 9.0);
                var lr = lrRaw > 2 ? lrRaw : 2;
                var minLakeDist = (double)(padRadius + lr + 3);
                var maxLakeRaw = bigR * 0.7;
                var maxLakeDist = maxLakeRaw > minLakeDist ? maxLakeRaw : minLakeDist;
                var angle = rng.Random() * JsMath.Pi * 2;
                var dist = minLakeDist + rng.Random() * (maxLakeDist - minLakeDist);
                var lx = (int)JsMath.JsRound(JsMath.JsCos(angle) * dist);
                var lz = (int)JsMath.JsRound(JsMath.JsSin(angle) * dist);
                foreach (var c in Cols())
                {
                    if (JsMath.Hypot(c.X - lx, c.Z - lz) <=
                        lr + 0.6 * n2(c.X, c.Z, seedD + 3, 0.3))
                    {
                        lakeCells.Add(ColKey(c.X, c.Z));
                    }
                }
                if (lakeCells.Count > 0)
                {
                    var lowest = int.MaxValue;
                    foreach (var k in lakeCells)
                    {
                        var h = heights[k].H;
                        if (h < lowest) lowest = h;
                    }
                    lakeLevel = lowest;
                }
            }

            // ---- fill columns
            var voxelCount = 0;
            foreach (var c in Cols())
            {
                var x = c.X;
                var z = c.Z;
                var h = c.H;
                if (lakeCells.Contains(ColKey(x, z)))
                {
                    var floor = lakeLevel - 2;
                    for (var y = -c.Dep; y < floor; y++)
                    {
                        world.SetBlock(x, y, z, Block.Stone);
                        voxelCount++;
                    }
                    world.SetBlock(x, floor, z, Block.Sand);
                    voxelCount++;
                    for (var y = floor + 1; y <= lakeLevel; y++)
                    {
                        world.SetBlock(x, y, z, Block.Water);
                        voxelCount++;
                    }
                    continue;
                }
                var nearLake = false;
                for (var dx = -1; dx <= 1 && !nearLake; dx++)
                {
                    for (var dz = -1; dz <= 1; dz++)
                    {
                        if (lakeCells.Contains(ColKey(x + dx, z + dz)))
                        {
                            nearLake = true;
                            break;
                        }
                    }
                }
                for (var y = -c.Dep; y <= h; y++)
                {
                    byte kind;
                    if (y == h)
                    {
                        kind = nearLake && h <= lakeLevel + 1 ? Block.Sand : Block.Grass;
                    }
                    else if (y >= h - 2)
                    {
                        kind = Block.Dirt;
                    }
                    else
                    {
                        kind = Block.Stone;
                        // one roll, as before: adding copper to the ladder must not shift the island's RNG
                        var r = rng.Random();
                        if (r < 0.03) kind = Block.OreCoal;
                        else if (r < 0.045) kind = Block.OreIron;
                        else if (r < 0.055) kind = Block.OreCopper;
                    }
                    world.SetBlock(x, y, z, kind);
                    voxelCount++;
                }
                // snow on the highest peaks of big islands
                if (h >= maxHeight + 1 && size >= 40) world.SetBlock(x, h, z, Block.Snow);
            }

            // ---- trees on grass, not on the pad
            var grassCells = new List<(int X, int H, int Z)>();
            foreach (var c in Cols())
            {
                if (lakeCells.Contains(ColKey(c.X, c.Z))) continue;
                if (world.GetBlock(c.X, c.H, c.Z) != Block.Grass) continue;
                var dist = JsMath.Hypot(c.X, c.Z);
                // +3: the radius-2 canopy must not overhang the pad
                if (dist > padRadius + 3 && dist < bigR * 0.85)
                {
                    grassCells.Add((c.X, c.H, c.Z));
                }
            }
            var shuffled = rng.Shuffle(grassCells);
            var placed = new List<(int X, int Z)>();
            var target = (int)JsMath.JsTrunc(grassCells.Count * p.TreeDensity);
            foreach (var (x, y, z) in shuffled)
            {
                if (placed.Count >= target) break;
                if (placed.All(q => System.Math.Abs(x - q.X) > 3 || System.Math.Abs(z - q.Z) > 3))
                {
                    AddTree(world, x, y + 1, z, rng);
                    placed.Add((x, z));
                }
            }

            return new IslandInfo(padHeight, voxelCount);
        }
    }
}
