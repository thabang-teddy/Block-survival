package com.blocksurvival.world

import com.blocksurvival.world.JsMath.JS_PI
import com.blocksurvival.world.JsMath.hypot
import com.blocksurvival.world.JsMath.jsCos
import com.blocksurvival.world.JsMath.jsRoundI
import com.blocksurvival.world.JsMath.jsSin
import com.blocksurvival.world.JsMath.jsTruncI

/**
 * Floating voxel island — twin of `server/resources/js/world/islandGen.ts`
 * (itself a port of Design/blender_scripts/islands.py `generate_island`).
 *
 * Origin = island centre, y = 0 is the lowest grass layer, the island hangs
 * below. The heightmap is built into an insertion-ordered map because the RNG
 * is consumed while iterating it — a plain HashMap would change every island.
 */

/** where generated voxels go: a template that is stamped into chunks later */
interface VoxelSink {
    fun getBlock(x: Int, y: Int, z: Int): Int
    fun setBlock(x: Int, y: Int, z: Int, id: Int)
    fun setBlockIfAir(x: Int, y: Int, z: Int, id: Int)
}

class IslandParams(
    val size: Int,
    val seed: Long,
    val maxHeight: Int,
    val depth: Int,
    val padRadius: Int,
    val lake: Boolean,
    val treeDensity: Double,
)

/** Island_Large from islands.py — the legacy island over the spawn pad */
val islandLarge = IslandParams(
    size = 56, seed = 11, maxHeight = 9, depth = 16, padRadius = 8, lake = true, treeDensity = 0.022,
)

val islandMedium = IslandParams(
    size = 32, seed = 7, maxHeight = 6, depth = 11, padRadius = 5, lake = true, treeDensity = 0.022,
)

class IslandInfo(val padHeight: Int, val voxelCount: Int)

private class Column(val x: Int, val z: Int, var h: Int, val dep: Int)

private fun colKey(x: Int, z: Int): Int = (x + 512) * 1024 + (z + 512)

private fun addTree(world: VoxelSink, x: Int, y: Int, z: Int, rng: Rng) {
    val height = rng.randint(4, 6)
    for (dy in 0 until height) {
        world.setBlock(x, y + dy, z, Block.LOG)
    }
    val top = y + height
    for (dy in -2 until 2) {
        val r = if (dy < 0) 2 else 1
        for (dx in -r..r) {
            for (dz in -r..r) {
                if (kotlin.math.abs(dx) == r && kotlin.math.abs(dz) == r && dy != -1) continue
                world.setBlockIfAir(x + dx, top + dy, z + dz, Block.LEAVES)
            }
        }
    }
    world.setBlock(x, top + 2, z, Block.LEAVES)
}

fun generateIsland(world: VoxelSink, p: IslandParams): IslandInfo {
    val size = p.size
    val seed = p.seed
    val maxHeight = p.maxHeight
    val depth = p.depth
    val padRadius = p.padRadius
    val rng = Rng(seed)
    val n2 = fractal2(PerlinNoise(seed))
    val bigR = size / 2.0
    val ri = jsTruncI(bigR)
    val seedD = seed.toDouble()

    // ---- heightmap + island mask (insertion order matters: the RNG is consumed in it)
    val heights = LinkedHashMap<Int, Column>()
    for (x in -ri - 1..ri + 1) {
        for (z in -ri - 1..ri + 1) {
            val xd = x.toDouble()
            val zd = z.toDouble()
            val d = hypot(xd, zd) / bigR
            val mask = 1 - d + 0.3 * n2(xd, zd, seedD, 0.09)
            if (mask <= 0.12) continue
            val hRaw = mask * maxHeight + 2 * n2(xd, zd, seedD + 1, 0.16)
            var h = if (mask > 0.5) jsRoundI(hRaw / 2) * 2 else jsRoundI(hRaw) // terraces inland
            h = if (h < 0) 0 else if (h > maxHeight + 2) maxHeight + 2 else h
            var dep = jsTruncI(mask * depth + 2 * n2(xd, zd, seedD + 2, 0.13) * mask)
            dep = if (dep < 1) 1 else dep
            heights[colKey(x, z)] = Column(x, z, h, dep)
        }
    }

    // ---- build pad: flat, at the height of the surrounding terrain
    var padHeight = 2
    if (padRadius != 0) {
        val ring = ArrayList<Int>()
        for (c in heights.values) {
            val dist = hypot(c.x.toDouble(), c.z.toDouble())
            if (dist > padRadius && dist <= padRadius + 3) ring.add(c.h)
        }
        if (ring.isNotEmpty()) {
            ring.sort()
            padHeight = jsRoundI(ring[ring.size shr 1] / 2.0) * 2 // median, snapped to a terrace
        }
        for (c in heights.values) {
            if (hypot(c.x.toDouble(), c.z.toDouble()) <= padRadius) c.h = padHeight
        }
    }

    // ---- lake: pick a spot on a ring that clears the pad
    val lakeCells = HashSet<Int>()
    var lakeLevel = 0
    if (p.lake) {
        val lrRaw = jsTruncI(size / 9.0)
        val lr = if (lrRaw > 2) lrRaw else 2
        val minLakeDist = (padRadius + lr + 3).toDouble()
        val maxLakeRaw = bigR * 0.7
        val maxLakeDist = if (maxLakeRaw > minLakeDist) maxLakeRaw else minLakeDist
        val angle = rng.random() * JS_PI * 2
        val dist = minLakeDist + rng.random() * (maxLakeDist - minLakeDist)
        val lx = jsRoundI(jsCos(angle) * dist)
        val lz = jsRoundI(jsSin(angle) * dist)
        for (c in heights.values) {
            if (hypot((c.x - lx).toDouble(), (c.z - lz).toDouble()) <=
                lr + 0.6 * n2(c.x.toDouble(), c.z.toDouble(), seedD + 3, 0.3)
            ) {
                lakeCells.add(colKey(c.x, c.z))
            }
        }
        if (lakeCells.isNotEmpty()) {
            var lowest = 1 shl 30
            for (k in lakeCells) {
                val h = heights.getValue(k).h
                if (h < lowest) lowest = h
            }
            lakeLevel = lowest
        }
    }

    // ---- fill columns
    var voxelCount = 0
    for (c in heights.values) {
        val x = c.x
        val z = c.z
        val h = c.h
        if (lakeCells.contains(colKey(x, z))) {
            val floor = lakeLevel - 2
            for (y in -c.dep until floor) {
                world.setBlock(x, y, z, Block.STONE)
                voxelCount++
            }
            world.setBlock(x, floor, z, Block.SAND)
            voxelCount++
            for (y in floor + 1..lakeLevel) {
                world.setBlock(x, y, z, Block.WATER)
                voxelCount++
            }
            continue
        }
        var nearLake = false
        var dx = -1
        while (dx <= 1 && !nearLake) {
            for (dz in -1..1) {
                if (lakeCells.contains(colKey(x + dx, z + dz))) {
                    nearLake = true
                    break
                }
            }
            dx++
        }
        for (y in -c.dep..h) {
            var kind: Int
            if (y == h) {
                kind = if (nearLake && h <= lakeLevel + 1) Block.SAND else Block.GRASS
            } else if (y >= h - 2) {
                kind = Block.DIRT
            } else {
                kind = Block.STONE
                // one roll, as before: adding copper to the ladder must not shift the island's RNG
                val r = rng.random()
                if (r < 0.03) {
                    kind = Block.ORE_COAL
                } else if (r < 0.045) {
                    kind = Block.ORE_IRON
                } else if (r < 0.055) {
                    kind = Block.ORE_COPPER
                }
            }
            world.setBlock(x, y, z, kind)
            voxelCount++
        }
        // snow on the highest peaks of big islands
        if (h >= maxHeight + 1 && size >= 40) world.setBlock(x, h, z, Block.SNOW)
    }

    // ---- trees on grass, not on the pad
    val grassCells = ArrayList<Triple<Int, Int, Int>>()
    for (c in heights.values) {
        if (lakeCells.contains(colKey(c.x, c.z))) continue
        if (world.getBlock(c.x, c.h, c.z) != Block.GRASS) continue
        val dist = hypot(c.x.toDouble(), c.z.toDouble())
        // +3: the radius-2 canopy must not overhang the pad
        if (dist > padRadius + 3 && dist < bigR * 0.85) {
            grassCells.add(Triple(c.x, c.h, c.z))
        }
    }
    val shuffled = rng.shuffle(grassCells)
    val placed = ArrayList<Pair<Int, Int>>()
    val target = jsTruncI(grassCells.size * p.treeDensity)
    for ((x, y, z) in shuffled) {
        if (placed.size >= target) break
        if (placed.all { kotlin.math.abs(x - it.first) > 3 || kotlin.math.abs(z - it.second) > 3 }) {
            addTree(world, x, y + 1, z, rng)
            placed.add(x to z)
        }
    }

    return IslandInfo(padHeight = padHeight, voxelCount = voxelCount)
}
