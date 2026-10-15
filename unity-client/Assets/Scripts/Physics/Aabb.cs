using BlockSurvival.World;

namespace BlockSurvival.Physics
{
    /// Axis-aligned box vs voxel grid collision — twin of <c>physics/aabb.ts</c>.
    /// Boxes are moved one axis at a time and clamped against the first solid
    /// block they would enter.
    public readonly struct Box
    {
        /// min corner
        public readonly double X, Y, Z;

        /// size on x, y, z
        public readonly double W, H, D;

        public Box(double x, double y, double z, double w, double h, double d)
        {
            X = x; Y = y; Z = z; W = w; H = h; D = d;
        }

        public Box Moved(double dx, double dy, double dz) => new Box(X + dx, Y + dy, Z + dz, W, H, D);
    }

    public readonly struct MoveResult
    {
        public readonly Box Box;
        public readonly bool HitX, HitY, HitZ;

        public MoveResult(Box box, bool hitX, bool hitY, bool hitZ)
        {
            Box = box; HitX = hitX; HitY = hitY; HitZ = hitZ;
        }
    }

    public static class Aabb
    {
        private const double Eps = 1e-4;

        public static bool BoxIntersectsSolid(WorldStore world, Box b)
        {
            var x0 = (int)System.Math.Floor(b.X + Eps);
            var x1 = (int)System.Math.Floor(b.X + b.W - Eps);
            var y0 = (int)System.Math.Floor(b.Y + Eps);
            var y1 = (int)System.Math.Floor(b.Y + b.H - Eps);
            var z0 = (int)System.Math.Floor(b.Z + Eps);
            var z1 = (int)System.Math.Floor(b.Z + b.D - Eps);
            for (var x = x0; x <= x1; x++)
            {
                for (var y = y0; y <= y1; y++)
                {
                    for (var z = z0; z <= z1; z++)
                    {
                        if (Palette.IsSolid(world.GetBlock(x, y, z))) return true;
                    }
                }
            }
            return false;
        }

        /// Move `dist` along one axis (0 = x, 1 = y, 2 = z); the clamped delta and whether it hit.
        private static (double Moved, bool Hit) SweepAxis(WorldStore world, Box b, int axis, double dist)
        {
            if (dist == 0) return (0, false);
            var min = new[] { b.X, b.Y, b.Z };
            var size = new[] { b.W, b.H, b.D };
            var sign = JsMath.JsSign(dist);
            // leading face position before and after the move
            var lead = sign > 0 ? min[axis] + size[axis] : min[axis];
            var target = lead + dist;
            // range of voxel slices the leading face passes through
            var from = sign > 0 ? (int)System.Math.Floor(lead - Eps) + 1 : (int)System.Math.Floor(lead + Eps) - 1;
            var to = sign > 0 ? (int)System.Math.Floor(target - Eps) : (int)System.Math.Floor(target + Eps);
            var oa = (axis + 1) % 3;
            var ob = (axis + 2) % 3;
            var a0 = (int)System.Math.Floor(min[oa] + Eps);
            var a1 = (int)System.Math.Floor(min[oa] + size[oa] - Eps);
            var b0 = (int)System.Math.Floor(min[ob] + Eps);
            var b1 = (int)System.Math.Floor(min[ob] + size[ob] - Eps);
            var coord = new int[3];
            var step = (int)sign;
            for (var s = from; sign > 0 ? s <= to : s >= to; s += step)
            {
                for (var a = a0; a <= a1; a++)
                {
                    for (var c = b0; c <= b1; c++)
                    {
                        coord[axis] = s;
                        coord[oa] = a;
                        coord[ob] = c;
                        if (Palette.IsSolid(world.GetBlock(coord[0], coord[1], coord[2])))
                        {
                            var wall = sign > 0 ? s : s + 1;
                            return (wall - lead - sign * Eps, true);
                        }
                    }
                }
            }
            return (dist, false);
        }

        public static MoveResult MoveBox(WorldStore world, Box box, double dx, double dy, double dz)
        {
            var b = box;
            var (my, hitY) = SweepAxis(world, b, 1, dy);
            b = b.Moved(0, my, 0);
            var (mx, hitX) = SweepAxis(world, b, 0, dx);
            b = b.Moved(mx, 0, 0);
            var (mz, hitZ) = SweepAxis(world, b, 2, dz);
            b = b.Moved(0, 0, mz);
            return new MoveResult(b, hitX, hitY, hitZ);
        }

        /// Ray vs box (slab test): the entry distance along the unit direction, or null.
        public static double? RayBox(
            double ox, double oy, double oz,
            double dx, double dy, double dz,
            Box b)
        {
            var tMin = 0.0;
            var tMax = double.PositiveInfinity;
            var mins = new[] { b.X, b.Y, b.Z };
            var maxs = new[] { b.X + b.W, b.Y + b.H, b.Z + b.D };
            var o = new[] { ox, oy, oz };
            var d = new[] { dx, dy, dz };
            for (var i = 0; i < 3; i++)
            {
                if (System.Math.Abs(d[i]) < 1e-9)
                {
                    if (o[i] < mins[i] || o[i] > maxs[i]) return null;
                    continue;
                }
                var t1 = (mins[i] - o[i]) / d[i];
                var t2 = (maxs[i] - o[i]) / d[i];
                if (t1 > t2) { var t = t1; t1 = t2; t2 = t; }
                if (t1 > tMin) tMin = t1;
                if (t2 < tMax) tMax = t2;
                if (tMin > tMax) return null;
            }
            return tMin;
        }
    }
}
