package com.blocksurvival.world

/**
 * Updraft columns — twin of `server/resources/js/world/updraft.ts`. Every
 * floating island has one glowing shaft rising from the ground to just above
 * its rim; a pure function of the island.
 */
class Updraft(
    /** world x/z of the shaft axis (block centres) */
    val x: Double,
    val z: Double,
    /** the shaft lifts between these world heights (feet y) */
    val bottomY: Int,
    val topY: Int,
    val radius: Double,
    /** the island it serves */
    val ix: Int,
    val iz: Int,
)

object UpdraftTuning {
    const val RADIUS = 1.25

    /** blocks of clear air between the island's edge and the shaft axis */
    const val GAP = 2

    /** how far above the rim the lift keeps working */
    const val ABOVE_RIM = 3
    const val RISE = 6.0
    const val SINK = 4.0

    /** m/s² towards the wanted vertical speed */
    const val ACCEL = 40.0
}

/** rim search order: east first, then the other cardinal directions */
private val DIRECTIONS = arrayOf(
    intArrayOf(1, 0), intArrayOf(-1, 0), intArrayOf(0, 1), intArrayOf(0, -1),
)
private const val STRIP_DEPTH = UpdraftTuning.GAP + 2
private const val STRIP_HALF_WIDTH = 1

typealias GroundHeight = (x: Int, z: Int) -> Int

/** no island block at all in this island-local column */
private fun columnIsClear(t: IslandTemplate, x: Int, z: Int): Boolean {
    for (y in t.minY..t.maxY) if (t.get(x, y, z) != AIR) return false
    return true
}

/** highest ground-like block (not a tree) in an island-local column, or null */
private fun rimTop(t: IslandTemplate, x: Int, z: Int): Int? {
    for (y in t.maxY downTo t.minY) {
        val id = t.get(x, y, z)
        if (id != AIR && id != Block.LOG && id != Block.LEAVES) return y
    }
    return null
}

/**
 * The shaft for an island: walk outward from the centre until a strip of
 * columns is clear of the island, and put the axis `gap` blocks past the edge.
 */
fun updraftFor(island: PlacedIsland, t: IslandTemplate, groundHeight: GroundHeight): Updraft {
    val extent = intArrayOf(-t.minX, t.maxX, -t.minZ, t.maxZ).max() + 1
    for (dir in DIRECTIONS) {
        val ux = dir[0]
        val uz = dir[1]
        val px = -uz
        val pz = ux
        var rim: Int? = null // top of the last island column met on this ray
        for (d in 0..extent) {
            val top = rimTop(t, d * ux, d * uz)
            if (top != null) rim = top
            if (d == 0) continue
            val rimValue = rim ?: continue
            var clear = true
            var k = 0
            while (k < STRIP_DEPTH && clear) {
                for (m in -STRIP_HALF_WIDTH..STRIP_HALF_WIDTH) {
                    if (!columnIsClear(t, (d + k) * ux + m * px, (d + k) * uz + m * pz)) {
                        clear = false
                        break
                    }
                }
                k++
            }
            if (!clear) continue
            val bx = island.x + (d + UpdraftTuning.GAP) * ux
            val bz = island.z + (d + UpdraftTuning.GAP) * uz
            return Updraft(
                x = bx + 0.5,
                z = bz + 0.5,
                bottomY = groundHeight(bx, bz) + 1,
                topY = island.baseY + rimValue + UpdraftTuning.ABOVE_RIM,
                radius = UpdraftTuning.RADIUS,
                ix = island.ix,
                iz = island.iz,
            )
        }
    }
    error("no clear rim for island ${island.ix},${island.iz}")
}

/** the shaft the point is inside, if any */
fun updraftAt(shafts: List<Updraft>, x: Double, y: Double, z: Double): Updraft? {
    for (u in shafts) {
        if (y < u.bottomY || y > u.topY) continue
        val dx = x - u.x
        val dz = z - u.z
        if (dx * dx + dz * dz <= u.radius * u.radius) return u
    }
    return null
}
