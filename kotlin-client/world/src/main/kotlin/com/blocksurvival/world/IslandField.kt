package com.blocksurvival.world

import com.blocksurvival.world.JsMath.jsRoundI
import kotlin.math.floor

/**
 * Where the floating islands are — twin of
 * `server/resources/js/world/islandField.ts`. The sky is divided into
 * [ISLAND_CELL]-metre cells; each cell hashes (seed, ix, iz) to decide whether
 * it holds an island and what it looks like. Cell (0, 0) is the legacy island
 * over the spawn pad.
 */
const val ISLAND_CELL = 96
const val ISLAND_CHANCE = 0.5
const val ISLAND_MIN_Y = 80
const val ISLAND_MAX_Y = 96
const val LEGACY_ISLAND_Y = 80

/** widest island plus the room its trees need; centres stay this far inside their cell */
const val MAX_HALF_EXTENT = 33

private const val TEMPLATE_CACHE = 48

private const val SALT_EXISTS = 1L
private const val SALT_OFFSET_X = 2L
private const val SALT_OFFSET_Z = 3L
private const val SALT_SIZE = 4L
private const val SALT_HEIGHT = 5L
private const val SALT_DEPTH = 6L
private const val SALT_LAKE = 7L
private const val SALT_SEED = 8L
private const val SALT_BASE_Y = 9L

class PlacedIsland(
    val ix: Int,
    val iz: Int,
    /** world x/z of the island centre */
    val x: Int,
    val z: Int,
    /** world y of the island's lowest grass layer (template y = 0) */
    val baseY: Int,
    val params: IslandParams,
) {
    val key: String get() = "$ix,$iz"
}

/** The island in a sky cell, or null for an empty cell. Pure in (seed, ix, iz). */
fun islandAtCell(seed: Long, ix: Int, iz: Int): PlacedIsland? {
    if (ix == 0 && iz == 0) {
        return PlacedIsland(ix, iz, 0, 0, LEGACY_ISLAND_Y, islandLarge)
    }
    if (hash01(seed, ix.toLong(), iz.toLong(), SALT_EXISTS) >= ISLAND_CHANCE) return null
    val size = 24 + 2 * floor(hash01(seed, ix.toLong(), iz.toLong(), SALT_SIZE) * 17).toInt() // 24..56, even
    val maxJitter = ISLAND_CELL / 2.0 - MAX_HALF_EXTENT
    val jx = (hash01(seed, ix.toLong(), iz.toLong(), SALT_OFFSET_X) * 2 - 1) * maxJitter
    val jz = (hash01(seed, ix.toLong(), iz.toLong(), SALT_OFFSET_Z) * 2 - 1) * maxJitter
    return PlacedIsland(
        ix = ix,
        iz = iz,
        x = jsRoundI(ix * ISLAND_CELL + ISLAND_CELL / 2.0 + jx),
        z = jsRoundI(iz * ISLAND_CELL + ISLAND_CELL / 2.0 + jz),
        baseY = ISLAND_MIN_Y +
            floor(hash01(seed, ix.toLong(), iz.toLong(), SALT_BASE_Y) * (ISLAND_MAX_Y - ISLAND_MIN_Y + 1)).toInt(),
        params = IslandParams(
            size = size,
            seed = hashInt(seed, ix.toLong(), iz.toLong(), SALT_SEED),
            maxHeight = 5 + floor(hash01(seed, ix.toLong(), iz.toLong(), SALT_HEIGHT) * 5).toInt(), // 5..9
            depth = 9 + floor(hash01(seed, ix.toLong(), iz.toLong(), SALT_DEPTH) * 8).toInt(), // 9..16
            padRadius = 0,
            lake = hash01(seed, ix.toLong(), iz.toLong(), SALT_LAKE) < 0.4,
            treeDensity = 0.022,
        ),
    )
}

/** Islands whose footprint may overlap the block range [x0, x1] × [z0, z1]. */
fun islandsNear(seed: Long, x0: Double, z0: Double, x1: Double, z1: Double): List<PlacedIsland> {
    val out = ArrayList<PlacedIsland>()
    // `/` then floor, not integer division: the range goes negative
    val ix0 = floor((x0 - MAX_HALF_EXTENT) / ISLAND_CELL).toInt()
    val ix1 = floor((x1 + MAX_HALF_EXTENT) / ISLAND_CELL).toInt()
    val iz0 = floor((z0 - MAX_HALF_EXTENT) / ISLAND_CELL).toInt()
    val iz1 = floor((z1 + MAX_HALF_EXTENT) / ISLAND_CELL).toInt()
    for (ix in ix0..ix1) {
        for (iz in iz0..iz1) {
            val island = islandAtCell(seed, ix, iz) ?: continue
            if (island.x + MAX_HALF_EXTENT < x0 || island.x - MAX_HALF_EXTENT > x1) continue
            if (island.z + MAX_HALF_EXTENT < z0 || island.z - MAX_HALF_EXTENT > z1) continue
            out.add(island)
        }
    }
    return out
}

/** Memoised island templates (generation is ~10 ms for a large island). */
class IslandTemplates {
    private val cache = LinkedHashMap<String, IslandTemplate>()

    fun get(island: PlacedIsland): IslandTemplate {
        val key = island.key
        val cached = cache.remove(key)
        if (cached != null) {
            cache[key] = cached // refresh LRU position
            return cached
        }
        val t = IslandTemplate(island.params)
        if (cache.size >= TEMPLATE_CACHE) cache.remove(cache.keys.iterator().next())
        cache[key] = t
        return t
    }
}
