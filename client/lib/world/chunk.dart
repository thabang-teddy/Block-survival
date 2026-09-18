/// Chunk geometry — twin of the constants in `server/resources/js/world/chunkStore.ts`.
/// 16³ chunks of block ids; x/z horizontal, y up; 1 voxel = 1 m.
library;

const int chunkSize = 16;
const int _shift = 4;
const int _mask = chunkSize - 1;
const int chunkVolume = chunkSize * chunkSize * chunkSize;

int chunkCoord(int v) => v >> _shift;

/// index of a block inside its chunk's byte array: `(x << 8) | (y << 4) | z`
int localIndex(int x, int y, int z) =>
    ((x & _mask) << 8) | ((y & _mask) << 4) | (z & _mask);
