package com.blocksurvival.world

/**
 * A floating island generated once into a dense block template, then stamped
 * into any chunk it overlaps — twin of
 * `server/resources/js/world/islandTemplate.ts`.
 */

/** room around the nominal radius for the noisy mask and tree canopies */
private const val XZ_MARGIN = 5

/** the island hangs up to ~depth × 1.5 below y = 0; peaks + trees reach above */
private const val Y_BELOW = 12
private const val Y_ABOVE = 16

class IslandTemplate(params: IslandParams) : VoxelSink {
    val ext: Int = params.size / 2 + XZ_MARGIN
    val yLo: Int = -(params.depth + Y_BELOW)
    val yHi: Int = params.maxHeight + Y_ABOVE
    val sx: Int = ext * 2 + 1
    val sy: Int = yHi - yLo + 1
    private val data = ByteArray(sx * sy * sx)

    // tight bounds of the non-air blocks, island-local. Int.MAX/MIN stand in for
    // "no blocks yet" (any query then falls outside and reads as air).
    var minX = Int.MAX_VALUE
    var minY = Int.MAX_VALUE
    var minZ = Int.MAX_VALUE
    var maxX = Int.MIN_VALUE
    var maxY = Int.MIN_VALUE
    var maxZ = Int.MIN_VALUE

    var voxelCount = 0
        private set

    /** y of the build pad's top block (only meaningful when params.padRadius > 0) */
    val padHeight: Int

    init {
        padHeight = generateIsland(this, params).padHeight
    }

    /** block at island-local coordinates; AIR outside the filled bounds */
    fun get(x: Int, y: Int, z: Int): Int {
        if (x < minX || x > maxX || y < minY || y > maxY || z < minZ || z > maxZ) return AIR
        return data[index(x, y, z)].toInt() and 0xff
    }

    override fun getBlock(x: Int, y: Int, z: Int): Int {
        if (!inside(x, y, z)) return AIR
        return data[index(x, y, z)].toInt() and 0xff
    }

    override fun setBlock(x: Int, y: Int, z: Int, id: Int) {
        if (!inside(x, y, z)) error("island block $x,$y,$z outside its template")
        val i = index(x, y, z)
        if ((data[i].toInt() and 0xff) == AIR && id != AIR) voxelCount++
        data[i] = id.toByte()
        if (id == AIR) return
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        if (z < minZ) minZ = z
        if (z > maxZ) maxZ = z
    }

    override fun setBlockIfAir(x: Int, y: Int, z: Int, id: Int) {
        if (getBlock(x, y, z) == AIR) setBlock(x, y, z, id)
    }

    private fun inside(x: Int, y: Int, z: Int): Boolean =
        x >= -ext && x <= ext && z >= -ext && z <= ext && y >= yLo && y <= yHi

    private fun index(x: Int, y: Int, z: Int): Int =
        ((z + ext) * sy + (y - yLo)) * sx + (x + ext)
}
