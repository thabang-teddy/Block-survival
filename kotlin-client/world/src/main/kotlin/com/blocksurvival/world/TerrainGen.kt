package com.blocksurvival.world

import kotlin.math.abs

/**
 * Per-chunk world generation — twin of
 * `server/resources/js/world/terrainGen.ts`: endless ground with floating
 * islands stamped over it. [TerrainGenerator.generateChunk] depends only on
 * (seed, cx, cy, cz), so chunks come out identical in any order.
 */

/** vertical band of the world: chunks cy 0 .. WORLD_CHUNKS_Y-1 (y 0..127) */
const val WORLD_CHUNKS_Y = 8
const val WORLD_HEIGHT = WORLD_CHUNKS_Y * CHUNK_SIZE

/** columns evaluated around a chunk so trees straddling its border are complete */
private const val BORDER = 4
private const val CANOPY = 2
private const val COLS = CHUNK_SIZE + 2 * BORDER
private const val COLUMN_CACHE = 512

/** a shaft sits at most this far from its island's centre */
private const val UPDRAFT_REACH = 8

class Spawn(val x: Double, val y: Double, val z: Double)

private class IslandRef(val island: PlacedIsland, val template: IslandTemplate)

/** heights / surfaces / trees for a chunk column plus a border ring around it */
private class ColumnBlock(
    val h: ShortArray,
    val tree: ByteArray,
    /** highest non-air block any ground column here can produce */
    val maxY: Int,
    val islands: List<IslandRef>,
)

class TerrainGenerator(val seed: Long) {
    val ground = GroundModel(seed)

    // the pad and the ground it eases into stay solid, so spawn can never drop into a cave
    val caves = CaveModel(seed, (PAD_RADIUS + PAD_BLEND).toDouble())
    val veins = VeinField(seed)

    private val templates = IslandTemplates()
    private val columns = LinkedHashMap<String, ColumnBlock>()
    private val updrafts = LinkedHashMap<String, Updraft>()

    /** where a new player stands: on the centre of the spawn pad */
    fun spawn(): Spawn = Spawn(0.5, (ground.padHeight + 1).toDouble(), 0.5)

    /** the updraft shaft of an island (memoised; a pure function of the island) */
    fun updraftOf(island: PlacedIsland): Updraft =
        updrafts.getOrPut(island.key) { updraftFor(island, templates.get(island), ground::height) }

    /** shafts whose axis lies inside the block range [x0, x1] × [z0, z1] */
    fun updraftsNear(x0: Double, z0: Double, x1: Double, z1: Double): List<Updraft> {
        val out = ArrayList<Updraft>()
        for (island in islandsNear(
            seed,
            x0 - UPDRAFT_REACH, z0 - UPDRAFT_REACH, x1 + UPDRAFT_REACH, z1 + UPDRAFT_REACH,
        )) {
            val u = updraftOf(island)
            if (u.x >= x0 && u.x <= x1 + 1 && u.z >= z0 && u.z <= z1 + 1) out.add(u)
        }
        return out
    }

    /** The pristine contents of a chunk, or null when it is all air. */
    fun generateChunk(cx: Int, cy: Int, cz: Int): ByteArray? {
        if (cy < 0 || cy >= WORLD_CHUNKS_Y) return null
        val col = columnBlock(cx, cz)
        val y0 = cy * CHUNK_SIZE
        val y1 = y0 + CHUNK_SIZE - 1
        val islands = col.islands.filter { r ->
            r.island.baseY + r.template.minY <= y1 && r.island.baseY + r.template.maxY >= y0
        }
        if (y0 > col.maxY && islands.isEmpty()) return null

        val data = ByteArray(CHUNK_VOLUME)
        var any = false
        val x0 = cx * CHUNK_SIZE
        val z0 = cz * CHUNK_SIZE
        for (lx in 0 until CHUNK_SIZE) {
            for (lz in 0 until CHUNK_SIZE) {
                val h = col.h[(lx + BORDER) * COLS + lz + BORDER].toInt()
                // the roof rule keeps every tunnel below h - caveRoof, well inside the stone
                val carve = y0 <= h - CAVE_ROOF
                for (ly in 0 until CHUNK_SIZE) {
                    val id = groundBlock(y0 + ly, h)
                    if (id == AIR) continue
                    if (carve && id == Block.STONE && caves.open(x0 + lx, y0 + ly, z0 + lz, h)) continue
                    data[localIndex(lx, ly, lz)] = id.toByte()
                    any = true
                }
            }
        }
        // ore last, and only into stone: a vein showing in a tunnel wall is one the caves cut open
        if (!aboveAllVeins(y0)) {
            any = stampVeins(
                data,
                veins.near(x0, y0, z0, x0 + CHUNK_SIZE - 1, y1, z0 + CHUNK_SIZE - 1),
                x0, y0, z0,
            ) || any
        }
        if (col.maxY >= y0) any = stampTrees(data, col, y0) || any
        for (r in islands) {
            any = stampIsland(
                data,
                r.template,
                x0 - r.island.x,
                y0 - r.island.baseY,
                z0 - r.island.z,
            ) || any
        }
        return if (any) data else null
    }

    private fun columnBlock(cx: Int, cz: Int): ColumnBlock {
        val key = "$cx,$cz"
        columns[key]?.let { return it }
        val x0 = cx * CHUNK_SIZE - BORDER
        val z0 = cz * CHUNK_SIZE - BORDER
        val h = ShortArray(COLS * COLS)
        var maxY = SEA_LEVEL
        for (i in 0 until COLS) {
            for (j in 0 until COLS) {
                val v = ground.height(x0 + i, z0 + j)
                h[i * COLS + j] = v.toShort()
                if (v > maxY) maxY = v
            }
        }

        fun heightAt(x: Int, z: Int): Int {
            val i = x - x0
            val j = z - z0
            return if (i in 0 until COLS && j in 0 until COLS) h[i * COLS + j].toInt() else ground.height(x, z)
        }

        val tree = ByteArray(COLS * COLS)
        for (i in CANOPY until COLS - CANOPY) {
            for (j in CANOPY until COLS - CANOPY) {
                tree[i * COLS + j] = ground.treeHeight(x0 + i, z0 + j, ::heightAt).toByte()
            }
        }
        val block = ColumnBlock(
            h = h,
            tree = tree,
            maxY = maxY + TREE_MAX_HEIGHT + 2,
            islands = islandsNear(
                seed,
                (cx * CHUNK_SIZE).toDouble(),
                (cz * CHUNK_SIZE).toDouble(),
                (cx * CHUNK_SIZE + CHUNK_SIZE - 1).toDouble(),
                (cz * CHUNK_SIZE + CHUNK_SIZE - 1).toDouble(),
            ).map { IslandRef(it, templates.get(it)) },
        )
        if (columns.size >= COLUMN_CACHE) columns.remove(columns.keys.iterator().next())
        columns[key] = block
        return block
    }
}

/** ground column layering: bedrock, stone, 3 dirt, surface, water up to sea level */
private fun groundBlock(y: Int, h: Int): Int {
    if (y == 0) return Block.BEDROCK
    if (y <= h - 4) return Block.STONE
    if (y <= h - 1) return Block.DIRT
    if (y == h) return GroundModel.surfaceFor(h)
    if (y <= SEA_LEVEL) return Block.WATER
    return AIR
}

private class Tree(val lx: Int, val lz: Int, val base: Int, val height: Int)

/** Trunks first, then leaves into air only, so overlapping canopies resolve the same way. */
private fun stampTrees(data: ByteArray, col: ColumnBlock, y0: Int): Boolean {
    var any = false

    fun put(lx: Int, y: Int, lz: Int, id: Int, onlyAir: Boolean) {
        if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < y0 || y >= y0 + CHUNK_SIZE) return
        val i = localIndex(lx, y - y0, lz)
        if (onlyAir && (data[i].toInt() and 0xff) != AIR) return
        data[i] = id.toByte()
        any = true
    }

    val trees = ArrayList<Tree>()
    for (i in BORDER - CANOPY until COLS - BORDER + CANOPY) {
        for (j in BORDER - CANOPY until COLS - BORDER + CANOPY) {
            val height = col.tree[i * COLS + j].toInt()
            if (height != 0) {
                trees.add(Tree(i - BORDER, j - BORDER, col.h[i * COLS + j].toInt() + 1, height))
            }
        }
    }
    for (t in trees) {
        for (dy in 0 until t.height) put(t.lx, t.base + dy, t.lz, Block.LOG, false)
    }
    for (t in trees) {
        val top = t.base + t.height
        for (dy in -2 until 2) {
            val r = if (dy < 0) 2 else 1
            for (dx in -r..r) {
                for (dz in -r..r) {
                    if (abs(dx) == r && abs(dz) == r && dy != -1) continue
                    put(t.lx + dx, top + dy, t.lz + dz, Block.LEAVES, true)
                }
            }
        }
        put(t.lx, top + 2, t.lz, Block.LEAVES, true)
    }
    return any
}

/** Copy the template's non-air blocks over the chunk; `ox/oy/oz` = chunk origin in island-local space. */
private fun stampIsland(data: ByteArray, t: IslandTemplate, ox: Int, oy: Int, oz: Int): Boolean {
    var any = false
    val lx0 = maxOf(0, t.minX - ox)
    val lx1 = minOf(CHUNK_SIZE - 1, t.maxX - ox)
    val lz0 = maxOf(0, t.minZ - oz)
    val lz1 = minOf(CHUNK_SIZE - 1, t.maxZ - oz)
    val ly0 = maxOf(0, t.minY - oy)
    val ly1 = minOf(CHUNK_SIZE - 1, t.maxY - oy)
    for (lx in lx0..lx1) {
        for (lz in lz0..lz1) {
            for (ly in ly0..ly1) {
                val id = t.get(ox + lx, oy + ly, oz + lz)
                if (id == AIR) continue
                data[localIndex(lx, ly, lz)] = id.toByte()
                any = true
            }
        }
    }
    return any
}
