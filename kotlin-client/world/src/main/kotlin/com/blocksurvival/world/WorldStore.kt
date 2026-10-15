package com.blocksurvival.world

/**
 * Sparse voxel world — twin of the `World` class in
 * `server/resources/js/world/chunkStore.ts` (named `WorldStore` here to match
 * the Unity port and keep the type distinct from the `world` package). 16³
 * chunks of block ids keyed by chunk coordinate; x/z horizontal, y up.
 *
 * Two modes: **static** (tests, templates) where [setBlock] allocates chunks on
 * demand, and **streamed** (the game) where a generator produces any chunk on
 * demand and columns are loaded / unloaded by the streamer.
 */

/** Extra data for prop blocks (torch, workbench, bed). */
class PropMeta(
    val id: Int,
    val x: Int,
    val y: Int,
    val z: Int,
    /** facing in radians, a multiple of π/2 */
    val yaw: Double,
    /** for multi-cell props: the other cell; `primary` cells own the model */
    val partner: Triple<Int, Int, Int>? = null,
    val primary: Boolean,
)

class Edit(val x: Int, val y: Int, val z: Int, val id: Int)

/** Produces the pristine contents of one chunk, or null when it is all air. */
typealias ChunkGenerator = (cx: Int, cy: Int, cz: Int) -> ByteArray?

typealias ChunkKey = Triple<Int, Int, Int>

fun blockKey(x: Int, y: Int, z: Int): String = "$x,$y,$z"

class WorldStore {
    private val chunks = LinkedHashMap<ChunkKey, ByteArray>()
    private var lastKey: ChunkKey? = null
    private var lastChunk: ByteArray? = null
    private val dirty = LinkedHashSet<ChunkKey>()
    private var removed = ArrayList<ChunkKey>()
    private var generator: ChunkGenerator? = null
    private var chunksY = 0
    private val loadedColumns = HashSet<Pair<Int, Int>>()

    /** prop block metadata keyed by blockKey; bumps [propsVersion] on change */
    val props = LinkedHashMap<String, PropMeta>()
    var propsVersion = 0

    /** when true, every block change is recorded in [edits] (enable after generation) */
    var trackEdits = false
    val edits = LinkedHashMap<String, Edit>()
    private val editsByChunk = LinkedHashMap<ChunkKey, LinkedHashMap<String, Edit>>()

    /** Switch to streamed mode: chunks come from `generator`, columns via [loadColumn]. */
    fun setGenerator(generator: ChunkGenerator, chunksY: Int) {
        this.generator = generator
        this.chunksY = chunksY
    }

    val isStreamed: Boolean get() = generator != null

    fun getChunk(cx: Int, cy: Int, cz: Int): ByteArray? = chunks[Triple(cx, cy, cz)]

    val chunkKeys: Set<ChunkKey> get() = chunks.keys

    val chunkCount: Int get() = chunks.size

    val loadedColumnCount: Int get() = loadedColumns.size

    /** Static worlds count as fully loaded; streamed worlds only where a column was loaded. */
    fun isColumnLoaded(x: Int, z: Int): Boolean =
        generator == null || loadedColumns.contains(chunkCoord(x) to chunkCoord(z))

    fun isChunkColumnLoaded(cx: Int, cz: Int): Boolean =
        generator == null || loadedColumns.contains(cx to cz)

    fun getBlock(x: Int, y: Int, z: Int): Int {
        val k = Triple(chunkCoord(x), chunkCoord(y), chunkCoord(z))
        val c: ByteArray?
        if (k == lastKey) {
            c = lastChunk
        } else {
            c = chunks[k]
            lastKey = k
            lastChunk = c
        }
        return if (c == null) AIR else c[localIndex(x, y, z)].toInt() and 0xff
    }

    fun hasBlock(x: Int, y: Int, z: Int): Boolean = getBlock(x, y, z) != AIR

    /** Write a block and mark affected chunks dirty. */
    fun setBlock(x: Int, y: Int, z: Int, id: Int) {
        val cx = chunkCoord(x)
        val cy = chunkCoord(y)
        val cz = chunkCoord(z)
        val key = Triple(cx, cy, cz)
        val pk = blockKey(x, y, z)
        var c = chunks[key]
        if (c == null) {
            if (generator != null && !loadedColumns.contains(cx to cz)) {
                if (props.remove(pk) != null) propsVersion++
                recordEdit(key, pk, x, y, z, id)
                return
            }
            if (id == AIR) return
            c = allocate(key)
        }
        val i = localIndex(x, y, z)
        if ((c[i].toInt() and 0xff) == id) return
        c[i] = id.toByte()
        if (props.remove(pk) != null) propsVersion++
        recordEdit(key, pk, x, y, z, id)
        dirty.add(key)
        markNeighbourChunks(x, y, z, cx, cy, cz)
    }

    /** Place a prop block with its metadata. */
    fun setProp(meta: PropMeta) {
        setBlock(meta.x, meta.y, meta.z, meta.id)
        props[blockKey(meta.x, meta.y, meta.z)] = meta
        propsVersion++
    }

    fun getProp(x: Int, y: Int, z: Int): PropMeta? = props[blockKey(x, y, z)]

    /** Same as [setBlock] but never overwrites an existing block. */
    fun setBlockIfAir(x: Int, y: Int, z: Int, id: Int) {
        if (getBlock(x, y, z) == AIR) setBlock(x, y, z, id)
    }

    /** Recorded edits inside one chunk (streamed mode re-applies these on load). */
    fun editsInChunk(cx: Int, cy: Int, cz: Int): Collection<Edit> =
        editsByChunk[Triple(cx, cy, cz)]?.values ?: emptyList()

    // ---------------------------------------------------------------- streaming

    /** Generate every chunk of a column, overlay its edits and mark it (and neighbours) dirty. */
    fun loadColumn(cx: Int, cz: Int) {
        val gen = generator ?: error("WorldStore.loadColumn needs a generator")
        if (!loadedColumns.add(cx to cz)) return
        for (cy in 0 until chunksY) {
            val key = Triple(cx, cy, cz)
            var data = gen(cx, cy, cz)
            val chunkEdits = editsByChunk[key]
            if (chunkEdits != null) {
                for (e in chunkEdits.values) {
                    if (data == null) {
                        if (e.id == AIR) continue
                        data = ByteArray(CHUNK_VOLUME)
                    }
                    data[localIndex(e.x, e.y, e.z)] = e.id.toByte()
                }
            }
            if (data == null) continue
            chunks[key] = data
            dirty.add(key)
        }
        lastKey = null
        // neighbours meshed against a missing column drew border faces; rebuild them
        for ((dx, dz) in listOf(1 to 0, -1 to 0, 0 to 1, 0 to -1)) {
            for (cy in 0 until chunksY) {
                dirtyIfExists(Triple(cx + dx, cy, cz + dz))
            }
        }
    }

    /** Drop a column's chunk data; edits and props stay so a later load restores them. */
    fun unloadColumn(cx: Int, cz: Int) {
        if (!loadedColumns.remove(cx to cz)) return
        for (cy in 0 until chunksY) {
            val key = Triple(cx, cy, cz)
            if (chunks.remove(key) == null) continue
            dirty.remove(key)
            removed.add(key)
        }
        lastKey = null
    }

    /** Chunks whose data was dropped. Calling this clears the list. */
    fun takeRemoved(): List<ChunkKey> {
        val out = removed
        removed = ArrayList()
        return out
    }

    /** Chunks whose mesh is stale. Calling this clears the set. */
    fun takeDirty(): List<ChunkKey> {
        val out = dirty.toList()
        dirty.clear()
        return out
    }

    fun markAllDirty() = dirty.addAll(chunks.keys)

    // ---------------------------------------------------------------- internals
    private fun allocate(key: ChunkKey): ByteArray {
        val c = ByteArray(CHUNK_VOLUME)
        chunks[key] = c
        lastKey = null
        return c
    }

    private fun recordEdit(chunk: ChunkKey, pk: String, x: Int, y: Int, z: Int, id: Int) {
        if (!trackEdits) return
        val e = Edit(x, y, z, id)
        edits[pk] = e
        editsByChunk.getOrPut(chunk) { LinkedHashMap() }[pk] = e
    }

    private fun markNeighbourChunks(x: Int, y: Int, z: Int, cx: Int, cy: Int, cz: Int) {
        val mask = CHUNK_SIZE - 1
        val lx = x and mask
        val ly = y and mask
        val lz = z and mask
        if (lx == 0) dirtyIfExists(Triple(cx - 1, cy, cz))
        if (lx == mask) dirtyIfExists(Triple(cx + 1, cy, cz))
        if (ly == 0) dirtyIfExists(Triple(cx, cy - 1, cz))
        if (ly == mask) dirtyIfExists(Triple(cx, cy + 1, cz))
        if (lz == 0) dirtyIfExists(Triple(cx, cy, cz - 1))
        if (lz == mask) dirtyIfExists(Triple(cx, cy, cz + 1))
    }

    private fun dirtyIfExists(key: ChunkKey) {
        if (chunks.containsKey(key)) dirty.add(key)
    }
}
