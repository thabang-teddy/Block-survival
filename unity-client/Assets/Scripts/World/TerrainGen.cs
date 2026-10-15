using System.Collections.Generic;
using System.Linq;

namespace BlockSurvival.World
{
    /// Per-chunk world generation — twin of <c>server/resources/js/world/terrainGen.ts</c>:
    /// endless ground with floating islands stamped over it. <see cref="TerrainGenerator.GenerateChunk"/>
    /// depends only on (seed, cx, cy, cz), so chunks come out identical in any order.
    public static class TerrainConst
    {
        /// vertical band of the world: chunks cy 0 .. WorldChunksY-1 (y 0..127)
        public const int WorldChunksY = 8;
        public const int WorldHeight = WorldChunksY * Chunk.Size;

        /// columns evaluated around a chunk so trees straddling its border are complete
        public const int Border = 4;
        public const int Canopy = 2;
        public const int Cols = Chunk.Size + 2 * Border;

        /// column blocks kept; each is 24×24 heights + tree table
        public const int ColumnCacheSize = 512;

        /// a shaft sits at most this far from its island's centre
        public const int UpdraftReach = 8;
    }

    public readonly struct Spawn
    {
        public readonly double X, Y, Z;
        public Spawn(double x, double y, double z) { X = x; Y = y; Z = z; }
    }

    public sealed class TerrainGenerator
    {
        private sealed class IslandRef
        {
            public readonly PlacedIsland Island;
            public readonly IslandTemplate Template;
            public IslandRef(PlacedIsland island, IslandTemplate template) { Island = island; Template = template; }
        }

        /// heights / surfaces / trees for a chunk column plus a border ring around it
        private sealed class ColumnBlock
        {
            public readonly short[] H;
            public readonly byte[] Tree;

            /// highest non-air block any ground column here can produce
            public readonly int MaxY;
            public readonly List<IslandRef> Islands;

            public ColumnBlock(short[] h, byte[] tree, int maxY, List<IslandRef> islands)
            {
                H = h;
                Tree = tree;
                MaxY = maxY;
                Islands = islands;
            }
        }

        public readonly long Seed;
        public readonly GroundModel Ground;

        /// the tunnels and the ore veins under the ground (issue #25)
        public readonly CaveModel Caves;
        public readonly VeinField Veins;

        private readonly IslandTemplates _templates = new IslandTemplates();
        private readonly LruCache<(long, long), ColumnBlock> _columns = new LruCache<(long, long), ColumnBlock>(TerrainConst.ColumnCacheSize);
        private readonly Dictionary<string, Updraft> _updrafts = new Dictionary<string, Updraft>();

        public TerrainGenerator(long seed)
        {
            Seed = seed;
            Ground = new GroundModel(seed);
            // the pad and the ground it eases into stay solid, so spawn can never drop into a cave
            Caves = new CaveModel(seed, GroundConst.PadRadius + GroundConst.PadBlend);
            Veins = new VeinField(seed);
        }

        /// where a new player stands: on the centre of the spawn pad
        public Spawn GetSpawn() => new Spawn(0.5, Ground.PadHeight + 1, 0.5);

        /// the updraft shaft of an island (memoised; a pure function of the island)
        public Updraft UpdraftOf(PlacedIsland island)
        {
            if (_updrafts.TryGetValue(island.Key, out var cached)) return cached;
            var u = UpdraftGen.UpdraftFor(island, _templates.Get(island), Ground.Height);
            _updrafts[island.Key] = u;
            return u;
        }

        /// shafts whose axis lies inside the block range [x0, x1] × [z0, z1]
        public List<Updraft> UpdraftsNear(double x0, double z0, double x1, double z1)
        {
            var outList = new List<Updraft>();
            foreach (var island in IslandField.IslandsNear(
                         Seed,
                         x0 - TerrainConst.UpdraftReach, z0 - TerrainConst.UpdraftReach,
                         x1 + TerrainConst.UpdraftReach, z1 + TerrainConst.UpdraftReach))
            {
                var u = UpdraftOf(island);
                if (u.X >= x0 && u.X <= x1 + 1 && u.Z >= z0 && u.Z <= z1 + 1) outList.Add(u);
            }
            return outList;
        }

        /// The pristine contents of a chunk, or null when it is all air.
        public byte[] GenerateChunk(long cx, long cy, long cz)
        {
            if (cy < 0 || cy >= TerrainConst.WorldChunksY) return null;
            var col = ColumnBlockOf(cx, cz);
            var y0 = cy * Chunk.Size;
            var y1 = y0 + Chunk.Size - 1;
            var islands = col.Islands
                .Where(r => r.Island.BaseY + r.Template.MinY <= y1 && r.Island.BaseY + r.Template.MaxY >= y0)
                .ToList();
            if (y0 > col.MaxY && islands.Count == 0) return null;

            var data = new byte[Chunk.Volume];
            var any = false;
            var x0 = cx * Chunk.Size;
            var z0 = cz * Chunk.Size;
            for (var lx = 0; lx < Chunk.Size; lx++)
            {
                for (var lz = 0; lz < Chunk.Size; lz++)
                {
                    var h = col.H[(lx + TerrainConst.Border) * TerrainConst.Cols + lz + TerrainConst.Border];
                    // the roof rule keeps every tunnel below h - caveRoof, which is well inside the stone
                    var carve = y0 <= h - CaveModel.CaveRoof;
                    for (var ly = 0; ly < Chunk.Size; ly++)
                    {
                        var id = GroundBlock(y0 + ly, h);
                        if (id == Block.Air) continue;
                        if (carve && id == Block.Stone && Caves.Open((int)(x0 + lx), (int)(y0 + ly), (int)(z0 + lz), h))
                        {
                            continue;
                        }
                        data[Chunk.LocalIndex(lx, (int)ly, lz)] = id;
                        any = true;
                    }
                }
            }
            // ore last, and only into stone: a vein showing in a tunnel wall is one the caves cut open
            if (!Underground.AboveAllVeins(y0))
            {
                any = Underground.StampVeins(
                    data,
                    Veins.Near(x0, y0, z0, x0 + Chunk.Size - 1, y1, z0 + Chunk.Size - 1),
                    x0, y0, z0) || any;
            }
            if (col.MaxY >= y0) any = StampTrees(data, col, y0) || any;
            foreach (var r in islands)
            {
                any = StampIsland(data, r.Template, (int)(x0 - r.Island.X), (int)(y0 - r.Island.BaseY), (int)(z0 - r.Island.Z)) || any;
            }
            return any ? data : null;
        }

        private ColumnBlock ColumnBlockOf(long cx, long cz) => _columns.GetOrAdd((cx, cz), () =>
        {
            var x0 = (int)(cx * Chunk.Size - TerrainConst.Border);
            var z0 = (int)(cz * Chunk.Size - TerrainConst.Border);
            var h = new short[TerrainConst.Cols * TerrainConst.Cols];
            var maxY = GroundConst.SeaLevel;
            for (var i = 0; i < TerrainConst.Cols; i++)
            {
                for (var j = 0; j < TerrainConst.Cols; j++)
                {
                    var v = Ground.Height(x0 + i, z0 + j);
                    h[i * TerrainConst.Cols + j] = (short)v;
                    if (v > maxY) maxY = v;
                }
            }

            int HeightAt(int x, int z)
            {
                var i = x - x0;
                var j = z - z0;
                return i >= 0 && i < TerrainConst.Cols && j >= 0 && j < TerrainConst.Cols
                    ? h[i * TerrainConst.Cols + j]
                    : Ground.Height(x, z);
            }

            var tree = new byte[TerrainConst.Cols * TerrainConst.Cols];
            for (var i = TerrainConst.Canopy; i < TerrainConst.Cols - TerrainConst.Canopy; i++)
            {
                for (var j = TerrainConst.Canopy; j < TerrainConst.Cols - TerrainConst.Canopy; j++)
                {
                    tree[i * TerrainConst.Cols + j] = (byte)Ground.TreeHeight(x0 + i, z0 + j, HeightAt);
                }
            }

            var islands = IslandField.IslandsNear(
                    Seed, cx * Chunk.Size, cz * Chunk.Size,
                    cx * Chunk.Size + Chunk.Size - 1, cz * Chunk.Size + Chunk.Size - 1)
                .Select(island => new IslandRef(island, _templates.Get(island)))
                .ToList();

            return new ColumnBlock(h, tree, maxY + GroundConst.TreeMaxHeight + 2, islands);
        });

        /// ground column layering: bedrock, stone, 3 dirt, surface, water up to sea level
        private static byte GroundBlock(long y, int h)
        {
            if (y == 0) return Block.Bedrock;
            if (y <= h - 4) return Block.Stone;
            if (y <= h - 1) return Block.Dirt;
            if (y == h) return GroundModel.SurfaceFor(h);
            if (y <= GroundConst.SeaLevel) return Block.Water;
            return Block.Air;
        }

        private readonly struct Tree
        {
            public readonly int Lx, Lz, Base, Height;
            public Tree(int lx, int lz, int b, int height) { Lx = lx; Lz = lz; Base = b; Height = height; }
        }

        /// Trunks first, then leaves into air only, so overlapping canopies resolve the same way from every chunk.
        private static bool StampTrees(byte[] data, ColumnBlock col, long y0)
        {
            var any = false;

            void Put(int lx, long y, int lz, byte id, bool onlyAir)
            {
                if (lx < 0 || lx >= Chunk.Size || lz < 0 || lz >= Chunk.Size || y < y0 || y >= y0 + Chunk.Size) return;
                var i = Chunk.LocalIndex(lx, (int)(y - y0), lz);
                if (onlyAir && data[i] != Block.Air) return;
                data[i] = id;
                any = true;
            }

            var trees = new List<Tree>();
            for (var i = TerrainConst.Border - TerrainConst.Canopy; i < TerrainConst.Cols - TerrainConst.Border + TerrainConst.Canopy; i++)
            {
                for (var j = TerrainConst.Border - TerrainConst.Canopy; j < TerrainConst.Cols - TerrainConst.Border + TerrainConst.Canopy; j++)
                {
                    var height = col.Tree[i * TerrainConst.Cols + j];
                    if (height != 0)
                    {
                        trees.Add(new Tree(i - TerrainConst.Border, j - TerrainConst.Border, col.H[i * TerrainConst.Cols + j] + 1, height));
                    }
                }
            }
            foreach (var t in trees)
            {
                for (var dy = 0; dy < t.Height; dy++) Put(t.Lx, t.Base + dy, t.Lz, Block.Log, false);
            }
            foreach (var t in trees)
            {
                var top = t.Base + t.Height;
                for (var dy = -2; dy < 2; dy++)
                {
                    var r = dy < 0 ? 2 : 1;
                    for (var dx = -r; dx <= r; dx++)
                    {
                        for (var dz = -r; dz <= r; dz++)
                        {
                            if (System.Math.Abs(dx) == r && System.Math.Abs(dz) == r && dy != -1) continue;
                            Put(t.Lx + dx, top + dy, t.Lz + dz, Block.Leaves, true);
                        }
                    }
                }
                Put(t.Lx, top + 2, t.Lz, Block.Leaves, true);
            }
            return any;
        }

        /// Copy the template's non-air blocks over the chunk; ox/oy/oz = chunk origin in island-local space.
        private static bool StampIsland(byte[] data, IslandTemplate t, int ox, int oy, int oz)
        {
            var any = false;
            var lx0 = System.Math.Max(0, t.MinX - ox);
            var lx1 = System.Math.Min(Chunk.Size - 1, t.MaxX - ox);
            var lz0 = System.Math.Max(0, t.MinZ - oz);
            var lz1 = System.Math.Min(Chunk.Size - 1, t.MaxZ - oz);
            var ly0 = System.Math.Max(0, t.MinY - oy);
            var ly1 = System.Math.Min(Chunk.Size - 1, t.MaxY - oy);
            for (var lx = lx0; lx <= lx1; lx++)
            {
                for (var lz = lz0; lz <= lz1; lz++)
                {
                    for (var ly = ly0; ly <= ly1; ly++)
                    {
                        var id = t.Get(ox + lx, oy + ly, oz + lz);
                        if (id == Block.Air) continue;
                        data[Chunk.LocalIndex(lx, ly, lz)] = id;
                        any = true;
                    }
                }
            }
            return any;
        }
    }
}
