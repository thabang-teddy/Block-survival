namespace BlockSurvival.World
{
    /// Block palette — twin of <c>server/resources/js/world/palette.ts</c>. Block ids are
    /// the bytes stored in chunks, so the numbering is part of the save format and
    /// the wire protocol; never renumber.
    public static class Block
    {
        public const byte Air = 0;
        public const byte Grass = 1;
        public const byte Dirt = 2;
        public const byte Stone = 3;
        public const byte Cobble = 4;
        public const byte Sand = 5;
        public const byte Gravel = 6;
        public const byte Log = 7;
        public const byte Planks = 8;
        public const byte Leaves = 9;
        public const byte Water = 10;
        public const byte Glass = 11;
        public const byte Snow = 12;
        public const byte OreIron = 13;
        public const byte OreCoal = 14;
        public const byte Torch = 15;
        public const byte Workbench = 16;
        public const byte Bed = 17;
        public const byte ReinforcedWall = 18;

        /// the unbreakable floor of the world at y = 0
        public const byte Bedrock = 19;

        // issue #25: the rest of the Overworld ores, found underground by depth
        public const byte OreCopper = 20;
        public const byte OreGold = 21;
        public const byte OreRedstone = 22;
        public const byte OreLapis = 23;
        public const byte OreDiamond = 24;
        public const byte OreEmerald = 25;
    }

    /// (top, side, bottom) colours in linear RGB 0..1
    public readonly struct Rgb
    {
        public readonly double R;
        public readonly double G;
        public readonly double B;

        public Rgb(double r, double g, double b)
        {
            R = r;
            G = g;
            B = b;
        }
    }

    public sealed class BlockDef
    {
        public readonly Rgb Top;
        public readonly Rgb Side;
        public readonly Rgb Bottom;

        /// 1 = opaque
        public readonly double Alpha;

        /// faces of neighbours are still drawn against this block
        public readonly bool SeeThrough;

        /// blocks player movement
        public readonly bool Solid;

        /// drawn as a placed model instead of chunk faces
        public readonly bool Prop;

        /// gives off light
        public readonly bool Light;

        public BlockDef(Rgb top, Rgb side, Rgb bottom, double alpha, bool seeThrough, bool solid,
            bool prop = false, bool light = false)
        {
            Top = top;
            Side = side;
            Bottom = bottom;
            Alpha = alpha;
            SeeThrough = seeThrough;
            Solid = solid;
            Prop = prop;
            Light = light;
        }

        public static BlockDef Uniform(Rgb c, double alpha, bool seeThrough, bool solid,
            bool prop = false, bool light = false) =>
            new BlockDef(c, c, c, alpha, seeThrough, solid, prop, light);
    }

    public static class Palette
    {
        public static readonly string[] BlockNames =
        {
            "air", "grass", "dirt", "stone", "cobble", "sand", "gravel", "log", "planks",
            "leaves", "water", "glass", "snow", "ore_iron", "ore_coal", "torch", "workbench",
            "bed", "reinforced_wall", "bedrock", "ore_copper", "ore_gold", "ore_redstone",
            "ore_lapis", "ore_diamond", "ore_emerald",
        };

        public static readonly BlockDef[] BlockDefs =
        {
            BlockDef.Uniform(new Rgb(0, 0, 0), 0, true, false),
            new BlockDef(new Rgb(0.40, 0.66, 0.24), new Rgb(0.52, 0.36, 0.20), new Rgb(0.52, 0.36, 0.20), 1, false, true),
            BlockDef.Uniform(new Rgb(0.52, 0.36, 0.20), 1, false, true),
            BlockDef.Uniform(new Rgb(0.52, 0.52, 0.52), 1, false, true),
            BlockDef.Uniform(new Rgb(0.44, 0.44, 0.46), 1, false, true),
            BlockDef.Uniform(new Rgb(0.86, 0.80, 0.58), 1, false, true),
            BlockDef.Uniform(new Rgb(0.58, 0.55, 0.52), 1, false, true),
            new BlockDef(new Rgb(0.70, 0.58, 0.36), new Rgb(0.40, 0.28, 0.15), new Rgb(0.70, 0.58, 0.36), 1, false, true),
            BlockDef.Uniform(new Rgb(0.72, 0.56, 0.34), 1, false, true),
            BlockDef.Uniform(new Rgb(0.24, 0.52, 0.18), 1, true, true),
            BlockDef.Uniform(new Rgb(0.22, 0.48, 0.85), 0.75, true, false),
            BlockDef.Uniform(new Rgb(0.75, 0.88, 0.95), 0.35, true, true),
            BlockDef.Uniform(new Rgb(0.95, 0.96, 0.98), 1, false, true),
            BlockDef.Uniform(new Rgb(0.62, 0.55, 0.48), 1, false, true),
            BlockDef.Uniform(new Rgb(0.30, 0.30, 0.30), 1, false, true),
            BlockDef.Uniform(new Rgb(1.0, 0.55, 0.10), 1, true, false, prop: true, light: true),
            BlockDef.Uniform(new Rgb(0.58, 0.44, 0.26), 1, true, true, prop: true),
            BlockDef.Uniform(new Rgb(0.35, 0.45, 0.30), 1, true, false, prop: true),
            new BlockDef(new Rgb(0.36, 0.38, 0.40), new Rgb(0.30, 0.32, 0.35), new Rgb(0.30, 0.32, 0.35), 1, false, true),
            BlockDef.Uniform(new Rgb(0.18, 0.18, 0.20), 1, false, true),
            // the ores of issue #25: stone-grey with the metal's tint, so a vein reads at torch range
            BlockDef.Uniform(new Rgb(0.62, 0.42, 0.28), 1, false, true),
            BlockDef.Uniform(new Rgb(0.85, 0.70, 0.25), 1, false, true),
            BlockDef.Uniform(new Rgb(0.62, 0.18, 0.18), 1, false, true),
            BlockDef.Uniform(new Rgb(0.20, 0.32, 0.68), 1, false, true),
            BlockDef.Uniform(new Rgb(0.42, 0.82, 0.85), 1, false, true),
            BlockDef.Uniform(new Rgb(0.22, 0.72, 0.40), 1, false, true),
        };

        public static BlockDef DefOf(int id) => id >= 0 && id < BlockDefs.Length ? BlockDefs[id] : null;

        public static bool IsSolid(int id) => DefOf(id)?.Solid ?? false;
        public static bool IsSeeThrough(int id) => DefOf(id)?.SeeThrough ?? true;
        public static bool IsTranslucent(int id) => (DefOf(id)?.Alpha ?? 0) < 1 && id != Block.Air;
        public static bool IsProp(int id) => DefOf(id)?.Prop ?? false;
    }
}
