namespace BlockSurvival.World
{
    /// DDA voxel raycast (Amanatides &amp; Woo) — twin of <c>world/raycast.ts</c>. The
    /// first non-air block hit within <c>maxDist</c>, with the face normal the ray
    /// entered through.
    public sealed class RayHit
    {
        public readonly int X, Y, Z;

        /// face normal of the entered face; place a block at (x, y, z) + normal
        public readonly int Nx, Ny, Nz;
        public readonly double Distance;
        public readonly byte Block;

        public RayHit(int x, int y, int z, int nx, int ny, int nz, double distance, byte block)
        {
            X = x; Y = y; Z = z;
            Nx = nx; Ny = ny; Nz = nz;
            Distance = distance;
            Block = block;
        }
    }

    public static class Raycast
    {
        public static RayHit RaycastVoxels(
            WorldStore world,
            double ox, double oy, double oz,
            double dx, double dy, double dz,
            double maxDist,
            bool ignoreWater = true)
        {
            var len = JsMath.Hypot3(dx, dy, dz);
            if (len == 0) return null;
            dx /= len;
            dy /= len;
            dz /= len;

            var x = (int)System.Math.Floor(ox);
            var y = (int)System.Math.Floor(oy);
            var z = (int)System.Math.Floor(oz);
            var stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
            var stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
            var stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);
            var tDeltaX = stepX != 0 ? System.Math.Abs(1 / dx) : double.PositiveInfinity;
            var tDeltaY = stepY != 0 ? System.Math.Abs(1 / dy) : double.PositiveInfinity;
            var tDeltaZ = stepZ != 0 ? System.Math.Abs(1 / dz) : double.PositiveInfinity;
            var tMaxX = stepX > 0 ? (x + 1 - ox) / dx : (stepX < 0 ? (x - ox) / dx : double.PositiveInfinity);
            var tMaxY = stepY > 0 ? (y + 1 - oy) / dy : (stepY < 0 ? (y - oy) / dy : double.PositiveInfinity);
            var tMaxZ = stepZ > 0 ? (z + 1 - oz) / dz : (stepZ < 0 ? (z - oz) / dz : double.PositiveInfinity);

            var nx = 0;
            var ny = 0;
            var nz = 0;
            var t = 0.0;
            // starting inside a block still reports it, with a zero normal
            for (var i = 0; i < 512; i++)
            {
                var block = world.GetBlock(x, y, z);
                if (block != Block.Air && !(ignoreWater && block == Block.Water))
                {
                    return new RayHit(x, y, z, nx, ny, nz, t, block);
                }
                if (tMaxX < tMaxY && tMaxX < tMaxZ)
                {
                    t = tMaxX;
                    tMaxX += tDeltaX;
                    x += stepX;
                    nx = -stepX; ny = 0; nz = 0;
                }
                else if (tMaxY < tMaxZ)
                {
                    t = tMaxY;
                    tMaxY += tDeltaY;
                    y += stepY;
                    nx = 0; ny = -stepY; nz = 0;
                }
                else
                {
                    t = tMaxZ;
                    tMaxZ += tDeltaZ;
                    z += stepZ;
                    nx = 0; ny = 0; nz = -stepZ;
                }
                if (t > maxDist) return null;
            }
            return null;
        }
    }
}
