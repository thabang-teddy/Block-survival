namespace BlockSurvival.World
{
    /// A floating island generated once into a dense block template, then stamped
    /// into any chunk it overlaps — twin of <c>server/resources/js/world/islandTemplate.ts</c>.
    public sealed class IslandTemplate : IVoxelSink
    {
        /// room around the nominal radius for the noisy mask and tree canopies
        private const int XzMargin = 5;

        /// the island hangs up to ~depth × 1.5 below y = 0; peaks + trees reach maxHeight + ~11 above
        private const int YBelow = 12;
        private const int YAbove = 16;

        /// stands in for ±Infinity on the bounds of a template with no blocks yet
        private const int Unset = 1 << 20;

        /// tight bounds of the non-air blocks, island-local
        public int MinX = Unset, MinY = Unset, MinZ = Unset;
        public int MaxX = -Unset, MaxY = -Unset, MaxZ = -Unset;

        /// y of the build pad's top block (only meaningful when params.PadRadius > 0)
        public readonly int PadHeight;
        public int VoxelCount;

        public readonly int Ext;
        public readonly int YLo;
        public readonly int YHi;
        public readonly int Sx;
        public readonly int Sy;

        private readonly byte[] _data;

        public IslandTemplate(IslandParams p)
        {
            Ext = p.Size / 2 + XzMargin;
            YLo = -(p.Depth + YBelow);
            YHi = p.MaxHeight + YAbove;
            Sx = Ext * 2 + 1;
            Sy = YHi - YLo + 1;
            _data = new byte[Sx * Sy * Sx];
            PadHeight = IslandGen.GenerateIsland(this, p).PadHeight;
        }

        /// block at island-local coordinates; AIR outside the template
        public byte Get(int x, int y, int z)
        {
            if (x < MinX || x > MaxX || y < MinY || y > MaxY || z < MinZ || z > MaxZ) return Block.Air;
            return _data[Index(x, y, z)];
        }

        public byte GetBlock(int x, int y, int z) => Inside(x, y, z) ? _data[Index(x, y, z)] : Block.Air;

        public void SetBlock(int x, int y, int z, byte id)
        {
            if (!Inside(x, y, z))
            {
                throw new System.InvalidOperationException($"island block {x},{y},{z} outside its template");
            }
            var i = Index(x, y, z);
            if (_data[i] == Block.Air && id != Block.Air) VoxelCount++;
            _data[i] = id;
            if (id == Block.Air) return;
            if (x < MinX) MinX = x;
            if (x > MaxX) MaxX = x;
            if (y < MinY) MinY = y;
            if (y > MaxY) MaxY = y;
            if (z < MinZ) MinZ = z;
            if (z > MaxZ) MaxZ = z;
        }

        public void SetBlockIfAir(int x, int y, int z, byte id)
        {
            if (GetBlock(x, y, z) == Block.Air) SetBlock(x, y, z, id);
        }

        private bool Inside(int x, int y, int z) =>
            x >= -Ext && x <= Ext && z >= -Ext && z <= Ext && y >= YLo && y <= YHi;

        private int Index(int x, int y, int z) =>
            ((z + Ext) * Sy + (y - YLo)) * Sx + (x + Ext);
    }
}
