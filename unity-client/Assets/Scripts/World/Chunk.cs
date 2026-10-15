namespace BlockSurvival.World
{
    /// Chunk geometry — twin of the constants in <c>server/resources/js/world/chunkStore.ts</c>.
    /// 16³ chunks of block ids; x/z horizontal, y up; 1 voxel = 1 m.
    public static class Chunk
    {
        public const int Size = 16;
        private const int Shift = 4;
        private const int Mask = Size - 1;
        public const int Volume = Size * Size * Size;

        public static long CoordOf(long v) => v >> Shift;

        /// index of a block inside its chunk's byte array: <c>(x &lt;&lt; 8) | (y &lt;&lt; 4) | z</c>
        public static int LocalIndex(int x, int y, int z) =>
            ((x & Mask) << 8) | ((y & Mask) << 4) | (z & Mask);
    }
}
