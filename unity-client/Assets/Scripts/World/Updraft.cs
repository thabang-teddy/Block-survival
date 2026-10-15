using System.Collections.Generic;
using System.Linq;

namespace BlockSurvival.World
{
    /// Updraft columns — twin of <c>server/resources/js/world/updraft.ts</c>. Every
    /// floating island has one glowing shaft rising from the ground to just above
    /// its rim; a pure function of the island, so host, clients and reloads agree
    /// on where it is.
    public sealed class Updraft
    {
        /// world x/z of the shaft axis (block centres)
        public readonly double X;
        public readonly double Z;

        /// the shaft lifts between these world heights (feet y)
        public readonly int BottomY;
        public readonly int TopY;
        public readonly double Radius;

        /// the island it serves
        public readonly int Ix;
        public readonly int Iz;

        public Updraft(double x, double z, int bottomY, int topY, double radius, int ix, int iz)
        {
            X = x;
            Z = z;
            BottomY = bottomY;
            TopY = topY;
            Radius = radius;
            Ix = ix;
            Iz = iz;
        }
    }

    public static class UpdraftTuning
    {
        public const double Radius = 1.25;

        /// blocks of clear air between the island's edge and the shaft axis
        public const int Gap = 2;

        /// how far above the rim the lift keeps working
        public const int AboveRim = 3;
        public const double Rise = 6;
        public const double Sink = 4;

        /// m/s² towards the wanted vertical speed
        public const double Accel = 40;
    }

    public delegate int GroundHeight(int x, int z);

    public static class UpdraftGen
    {
        /// rim search order: east first, then the other cardinal directions
        private static readonly (int Ux, int Uz)[] Directions = { (1, 0), (-1, 0), (0, 1), (0, -1) };
        private const int StripDepth = UpdraftTuning.Gap + 2;
        private const int StripHalfWidth = 1;

        /// no island block at all (shore, roots, trees) in this island-local column
        private static bool ColumnIsClear(IslandTemplate t, int x, int z)
        {
            for (var y = t.MinY; y <= t.MaxY; y++)
            {
                if (t.Get(x, y, z) != Block.Air) return false;
            }
            return true;
        }

        /// highest ground-like block (not a tree) in an island-local column, or null
        private static int? RimTop(IslandTemplate t, int x, int z)
        {
            for (var y = t.MaxY; y >= t.MinY; y--)
            {
                var id = t.Get(x, y, z);
                if (id != Block.Air && id != Block.Log && id != Block.Leaves) return y;
            }
            return null;
        }

        /// The shaft for an island: walk outward from the centre until a strip of
        /// columns is clear of the island, and put the axis `gap` blocks past the edge.
        public static Updraft UpdraftFor(PlacedIsland island, IslandTemplate t, GroundHeight groundHeight)
        {
            var extent = new[] { -t.MinX, t.MaxX, -t.MinZ, t.MaxZ }.Max() + 1;
            foreach (var (ux, uz) in Directions)
            {
                var px = -uz;
                var pz = ux;
                int? rim = null; // top of the last island column met on this ray
                for (var d = 0; d <= extent; d++)
                {
                    var top = RimTop(t, d * ux, d * uz);
                    if (top.HasValue) rim = top;
                    if (d == 0 || rim == null) continue;
                    var clear = true;
                    for (var k = 0; k < StripDepth && clear; k++)
                    {
                        for (var m = -StripHalfWidth; m <= StripHalfWidth; m++)
                        {
                            if (!ColumnIsClear(t, (d + k) * ux + m * px, (d + k) * uz + m * pz))
                            {
                                clear = false;
                                break;
                            }
                        }
                    }
                    if (!clear) continue;
                    var bx = island.X + (d + UpdraftTuning.Gap) * ux;
                    var bz = island.Z + (d + UpdraftTuning.Gap) * uz;
                    return new Updraft(
                        x: bx + 0.5,
                        z: bz + 0.5,
                        bottomY: groundHeight(bx, bz) + 1,
                        topY: island.BaseY + rim.Value + UpdraftTuning.AboveRim,
                        radius: UpdraftTuning.Radius,
                        ix: island.Ix,
                        iz: island.Iz);
                }
            }
            throw new System.InvalidOperationException($"no clear rim for island {island.Ix},{island.Iz}");
        }

        /// the shaft the point is inside, if any
        public static Updraft UpdraftAt(IReadOnlyList<Updraft> shafts, double x, double y, double z)
        {
            foreach (var u in shafts)
            {
                if (y < u.BottomY || y > u.TopY) continue;
                var dx = x - u.X;
                var dz = z - u.Z;
                if (dx * dx + dz * dz <= u.Radius * u.Radius) return u;
            }
            return null;
        }
    }
}
