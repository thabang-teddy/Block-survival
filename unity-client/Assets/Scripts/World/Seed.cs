using System;

namespace BlockSurvival.World
{
    public enum WorldKind
    {
        Own,
        Global,
    }

    /// World seeds — twin of <c>server/resources/js/world/seed.ts</c>. A player's own
    /// world gets a random seed; the shared global world is always the classic seed.
    public static class Seed
    {
        /// the legacy island's seed (islandLarge.seed)
        public const long GlobalSeed = 11;

        /// a fresh 31-bit seed for a new own world; never the global one
        public static long NewWorldSeed(Random random = null)
        {
            var rng = random ?? new Random();
            while (true)
            {
                var seed = (long)Math.Floor(rng.NextDouble() * 0x7fffffff);
                if (seed != GlobalSeed && seed > 0) return seed;
            }
        }

        /// short tag a player can recognise a world by ("#1a2b3c")
        public static string SeedTag(long seed)
        {
            var hex = (seed & 0xFFFFFFFFL).ToString("x").PadLeft(6, '0');
            return "#" + hex.Substring(hex.Length - 6);
        }
    }
}
