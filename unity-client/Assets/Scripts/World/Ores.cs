using System.Collections.Generic;
using System.Linq;

namespace BlockSurvival.World
{
    /// The minerals of the world (issue #25) — twin of <c>server/resources/js/world/ores.ts</c>.
    ///
    /// One table serves three readers that must never disagree: the vein generator
    /// (<see cref="Underground"/>) places ore by these depth bands, the item registry
    /// takes the drop, hardness and pickaxe tier from here, and the HUD's minerals
    /// guide reads it straight out to tell the player where to dig.
    ///
    /// Order is part of the contract: vein selection walks this list accumulating
    /// <see cref="OreDef.Chance"/>, so moving a row changes every world.
    public sealed class OreDef
    {
        /// the block as it sits in the ground
        public readonly byte Block;

        /// item id it drops when broken
        public readonly string Drop;

        /// lowest/highest y a vein of this ore is placed at
        public readonly int MinY;
        public readonly int MaxY;

        /// chance a vein cell inside the band holds this ore (see Underground.VeinCell)
        public readonly double Chance;

        /// blocks in one vein, inclusive
        public readonly int SizeMin;
        public readonly int SizeMax;

        /// pickaxe tier needed to break it (see items/registry)
        public readonly int Tier;

        /// seconds to break with bare hands, before the tool's speed divides it
        public readonly double Hardness;

        /// one line for the minerals guide
        public readonly string Note;

        public OreDef(byte block, string drop, int minY, int maxY, double chance,
            int sizeMin, int sizeMax, int tier, double hardness, string note)
        {
            Block = block;
            Drop = drop;
            MinY = minY;
            MaxY = maxY;
            Chance = chance;
            SizeMin = sizeMin;
            SizeMax = sizeMax;
            Tier = tier;
            Hardness = hardness;
            Note = note;
        }
    }

    /// Bands are roughly Minecraft's, squeezed into this world's 0-127 band: bedrock is
    /// y 0, the sea sits at 32 and the ground runs 24-52, so "deep" here means single
    /// digits. Emerald has no upper limit worth fussing over — it can only ever appear
    /// where there is stone that high, which is under mountains.
    public static class Ores
    {
        public static readonly OreDef[] All =
        {
            new OreDef(Block.OreCoal, "coal", 8, 60, 0.22, 6, 14, 1, 5,
                "Everywhere below the soil — the first thing your wooden pickaxe can use."),
            new OreDef(Block.OreCopper, "copper", 6, 48, 0.16, 5, 12, 2, 5.5,
                "Big shallow veins. A copper pickaxe is the cheap step up from stone."),
            new OreDef(Block.OreIron, "iron", 4, 44, 0.14, 4, 9, 2, 6,
                "Common all the way down. Iron opens the rifle, walls and the deep ores."),
            new OreDef(Block.OreLapis, "lapis", 1, 26, 0.05, 3, 7, 2, 6,
                "Deep and scattered. The lens of a prospector is cut from it."),
            new OreDef(Block.OreGold, "gold", 2, 28, 0.05, 3, 7, 4, 6.5,
                "Needs an iron pickaxe. Gold tools dig faster than anything but diamond."),
            new OreDef(Block.OreRedstone, "redstone", 1, 15, 0.07, 4, 9, 4, 6.5,
                "Right down at the bottom. Doubles a batch of rifle ammo and powers the prospector."),
            new OreDef(Block.OreDiamond, "diamond", 1, 12, 0.03, 2, 5, 4, 7.5,
                "The last twelve blocks above bedrock, in ones and twos. The best pickaxe and sword."),
            new OreDef(Block.OreEmerald, "emerald", 28, 50, 0.08, 1, 3, 4, 7.5,
                "Ones and twos, and only inside high ground — there is no stone that high anywhere else."),
        };

        private static readonly Dictionary<byte, OreDef> ByBlock = All.ToDictionary(o => o.Block);

        public static OreDef OreOf(byte block) => ByBlock.TryGetValue(block, out var o) ? o : null;
        public static bool IsOre(byte block) => ByBlock.ContainsKey(block);

        /// the ores whose band contains [y], richest first — what the depth readout and the guide list
        public static List<OreDef> OresAt(int y) => All.Where(o => y >= o.MinY && y <= o.MaxY).ToList();

        /// What the ore bands call this height.
        public static string DepthBand(int y)
        {
            if (y <= 12) return "bedrock depths";
            if (y <= 28) return "deep rock";
            if (y <= 48) return "shallow rock";
            return "high ground";
        }

        /// How far under the surface the player is, for the HUD.
        public static string DepthNote(double y, int surfaceY)
        {
            var under = (long)System.Math.Round(surfaceY - y, System.MidpointRounding.AwayFromZero);
            return under <= 0 ? "above ground" : $"{under} m down";
        }
    }
}
