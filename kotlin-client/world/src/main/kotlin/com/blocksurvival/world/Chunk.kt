package com.blocksurvival.world

/**
 * Chunk geometry — twin of the constants in
 * `server/resources/js/world/chunkStore.ts`. 16³ chunks of block ids; x/z
 * horizontal, y up; 1 voxel = 1 m.
 */
const val CHUNK_SIZE = 16
private const val SHIFT = 4
private const val MASK = CHUNK_SIZE - 1
const val CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE

fun chunkCoord(v: Int): Int = v shr SHIFT

/** index of a block inside its chunk's byte array: `(x << 8) | (y << 4) | z` */
fun localIndex(x: Int, y: Int, z: Int): Int =
    ((x and MASK) shl 8) or ((y and MASK) shl 4) or (z and MASK)
