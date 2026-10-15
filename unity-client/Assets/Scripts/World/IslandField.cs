using System.Collections.Generic;

namespace BlockSurvival.World
{
    /// Where the floating islands are — twin of <c>server/resources/js/world/islandField.ts</c>.
    /// The sky is divided into <see cref="IslandCell"/>-metre cells; each cell hashes
    /// (seed, ix, iz) to decide whether it holds an island and what it looks like.
    /// Cell (0, 0) is the legacy island over the spawn pad.
    public static class IslandFieldConst
    {
        public const int IslandCell = 96;
        public const double IslandChance = 0.5;

        /// lowest grass layer of a generated island floats between these heights
        public const int IslandMinY = 80;
        public const int IslandMaxY = 96;
        public const int LegacyIslandY = 80;

        /// widest island plus the room its trees need; centres stay this far inside their cell
        public const int MaxHalfExtent = 33;

        /// templates kept in memory; islands beyond that are regenerated when needed
        public const int TemplateCache = 48;

        public const int SaltExists = 1;
        public const int SaltOffsetX = 2;
        public const int SaltOffsetZ = 3;
        public const int SaltSize = 4;
        public const int SaltHeight = 5;
        public const int SaltDepth = 6;
        public const int SaltLake = 7;
        public const int SaltSeed = 8;
        public const int SaltBaseY = 9;
    }

    public sealed class PlacedIsland
    {
        public readonly int Ix;
        public readonly int Iz;

        /// world x/z of the island centre
        public readonly int X;
        public readonly int Z;

        /// world y of the island's lowest grass layer (template y = 0)
        public readonly int BaseY;
        public readonly IslandParams Params;

        public PlacedIsland(int ix, int iz, int x, int z, int baseY, IslandParams p)
        {
            Ix = ix;
            Iz = iz;
            X = x;
            Z = z;
            BaseY = baseY;
            Params = p;
        }

        public string Key => $"{Ix},{Iz}";
    }

    public static class IslandField
    {
        /// The island in a sky cell, or null for an empty cell. Pure in (seed, ix, iz).
        public static PlacedIsland IslandAtCell(long seed, int ix, int iz)
        {
            if (ix == 0 && iz == 0)
            {
                return new PlacedIsland(ix, iz, 0, 0, IslandFieldConst.LegacyIslandY, IslandGen.IslandLarge);
            }
            if (Noise.Hash01(seed, ix, iz, IslandFieldConst.SaltExists) >= IslandFieldConst.IslandChance) return null;
            var size = 24 + 2 * (int)(Noise.Hash01(seed, ix, iz, IslandFieldConst.SaltSize) * 17); // 24..56, even
            const double maxJitter = IslandFieldConst.IslandCell / 2.0 - IslandFieldConst.MaxHalfExtent;
            var jx = (Noise.Hash01(seed, ix, iz, IslandFieldConst.SaltOffsetX) * 2 - 1) * maxJitter;
            var jz = (Noise.Hash01(seed, ix, iz, IslandFieldConst.SaltOffsetZ) * 2 - 1) * maxJitter;
            return new PlacedIsland(
                ix, iz,
                x: (int)JsMath.JsRound(ix * IslandFieldConst.IslandCell + IslandFieldConst.IslandCell / 2.0 + jx),
                z: (int)JsMath.JsRound(iz * IslandFieldConst.IslandCell + IslandFieldConst.IslandCell / 2.0 + jz),
                baseY: IslandFieldConst.IslandMinY +
                       (int)(Noise.Hash01(seed, ix, iz, IslandFieldConst.SaltBaseY) *
                             (IslandFieldConst.IslandMaxY - IslandFieldConst.IslandMinY + 1)),
                p: new IslandParams(
                    size: size,
                    seed: Noise.HashInt(seed, ix, iz, IslandFieldConst.SaltSeed),
                    maxHeight: 5 + (int)(Noise.Hash01(seed, ix, iz, IslandFieldConst.SaltHeight) * 5), // 5..9
                    depth: 9 + (int)(Noise.Hash01(seed, ix, iz, IslandFieldConst.SaltDepth) * 8), // 9..16
                    padRadius: 0,
                    lake: Noise.Hash01(seed, ix, iz, IslandFieldConst.SaltLake) < 0.4,
                    treeDensity: 0.022));
        }

        /// Islands whose footprint may overlap the block range [x0, x1] × [z0, z1].
        /// The player controller passes fractional positions, so the bounds are doubles.
        public static List<PlacedIsland> IslandsNear(long seed, double x0, double z0, double x1, double z1)
        {
            var outList = new List<PlacedIsland>();
            // floor after dividing, not integer division: the range goes negative
            var ix0 = (int)System.Math.Floor((x0 - IslandFieldConst.MaxHalfExtent) / IslandFieldConst.IslandCell);
            var ix1 = (int)System.Math.Floor((x1 + IslandFieldConst.MaxHalfExtent) / IslandFieldConst.IslandCell);
            var iz0 = (int)System.Math.Floor((z0 - IslandFieldConst.MaxHalfExtent) / IslandFieldConst.IslandCell);
            var iz1 = (int)System.Math.Floor((z1 + IslandFieldConst.MaxHalfExtent) / IslandFieldConst.IslandCell);
            for (var ix = ix0; ix <= ix1; ix++)
            {
                for (var iz = iz0; iz <= iz1; iz++)
                {
                    var island = IslandAtCell(seed, ix, iz);
                    if (island == null) continue;
                    if (island.X + IslandFieldConst.MaxHalfExtent < x0 || island.X - IslandFieldConst.MaxHalfExtent > x1) continue;
                    if (island.Z + IslandFieldConst.MaxHalfExtent < z0 || island.Z - IslandFieldConst.MaxHalfExtent > z1) continue;
                    outList.Add(island);
                }
            }
            return outList;
        }
    }

    /// Memoised island templates (generation is ~10 ms for a large island).
    public sealed class IslandTemplates
    {
        private readonly LruCache<string, IslandTemplate> _cache = new LruCache<string, IslandTemplate>(IslandFieldConst.TemplateCache);

        public IslandTemplate Get(PlacedIsland island) =>
            _cache.GetOrAdd(island.Key, () => new IslandTemplate(island.Params));
    }
}
