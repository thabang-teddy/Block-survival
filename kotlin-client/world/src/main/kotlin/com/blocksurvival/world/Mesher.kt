package com.blocksurvival.world

/**
 * Culled chunk mesher — twin of `server/resources/js/world/mesher.ts` (via
 * `client/lib/world/mesher.dart`). Emits only exposed faces, with per-vertex
 * colours from the palette and baked 4-level ambient occlusion. Two geometries
 * per chunk: opaque and translucent.
 *
 * Vertices are interleaved for the GPU: position(3) normal(3) colour(4), all
 * float32 — see [VERTEX_FLOATS].
 */

/** floats per vertex in [MeshData.vertices] */
const val VERTEX_FLOATS = 10
const val VERTEX_BYTES = VERTEX_FLOATS * 4

class MeshData(
    /** interleaved x y z nx ny nz r g b a */
    val vertices: FloatArray,
    val indices: IntArray,
) {
    val vertexCount: Int get() = vertices.size / VERTEX_FLOATS
}

class ChunkMesh(val opaque: MeshData? = null, val translucent: MeshData? = null) {
    val isEmpty: Boolean get() = opaque == null && translucent == null
}

private class Face(
    val n: IntArray,
    /** CCW seen from outside */
    val corners: Array<IntArray>,
    /** 0 top, 1 side, 2 bottom colour */
    val slot: Int,
    /** the two in-plane axes used for AO neighbour sampling, per corner */
    val ao: Array<Array<IntArray>>,
)

private val FACES = arrayOf(
    Face(
        intArrayOf(0, 1, 0),
        arrayOf(intArrayOf(0, 1, 0), intArrayOf(0, 1, 1), intArrayOf(1, 1, 1), intArrayOf(1, 1, 0)),
        0,
        arrayOf(
            arrayOf(intArrayOf(-1, 0, 0), intArrayOf(0, 0, -1)),
            arrayOf(intArrayOf(-1, 0, 0), intArrayOf(0, 0, 1)),
            arrayOf(intArrayOf(1, 0, 0), intArrayOf(0, 0, 1)),
            arrayOf(intArrayOf(1, 0, 0), intArrayOf(0, 0, -1)),
        ),
    ),
    Face(
        intArrayOf(0, -1, 0),
        arrayOf(intArrayOf(0, 0, 0), intArrayOf(1, 0, 0), intArrayOf(1, 0, 1), intArrayOf(0, 0, 1)),
        2,
        arrayOf(
            arrayOf(intArrayOf(-1, 0, 0), intArrayOf(0, 0, -1)),
            arrayOf(intArrayOf(1, 0, 0), intArrayOf(0, 0, -1)),
            arrayOf(intArrayOf(1, 0, 0), intArrayOf(0, 0, 1)),
            arrayOf(intArrayOf(-1, 0, 0), intArrayOf(0, 0, 1)),
        ),
    ),
    Face(
        intArrayOf(1, 0, 0),
        arrayOf(intArrayOf(1, 0, 0), intArrayOf(1, 1, 0), intArrayOf(1, 1, 1), intArrayOf(1, 0, 1)),
        1,
        arrayOf(
            arrayOf(intArrayOf(0, -1, 0), intArrayOf(0, 0, -1)),
            arrayOf(intArrayOf(0, 1, 0), intArrayOf(0, 0, -1)),
            arrayOf(intArrayOf(0, 1, 0), intArrayOf(0, 0, 1)),
            arrayOf(intArrayOf(0, -1, 0), intArrayOf(0, 0, 1)),
        ),
    ),
    Face(
        intArrayOf(-1, 0, 0),
        arrayOf(intArrayOf(0, 0, 1), intArrayOf(0, 1, 1), intArrayOf(0, 1, 0), intArrayOf(0, 0, 0)),
        1,
        arrayOf(
            arrayOf(intArrayOf(0, -1, 0), intArrayOf(0, 0, 1)),
            arrayOf(intArrayOf(0, 1, 0), intArrayOf(0, 0, 1)),
            arrayOf(intArrayOf(0, 1, 0), intArrayOf(0, 0, -1)),
            arrayOf(intArrayOf(0, -1, 0), intArrayOf(0, 0, -1)),
        ),
    ),
    Face(
        intArrayOf(0, 0, 1),
        arrayOf(intArrayOf(0, 0, 1), intArrayOf(1, 0, 1), intArrayOf(1, 1, 1), intArrayOf(0, 1, 1)),
        1,
        arrayOf(
            arrayOf(intArrayOf(-1, 0, 0), intArrayOf(0, -1, 0)),
            arrayOf(intArrayOf(1, 0, 0), intArrayOf(0, -1, 0)),
            arrayOf(intArrayOf(1, 0, 0), intArrayOf(0, 1, 0)),
            arrayOf(intArrayOf(-1, 0, 0), intArrayOf(0, 1, 0)),
        ),
    ),
    Face(
        intArrayOf(0, 0, -1),
        arrayOf(intArrayOf(1, 0, 0), intArrayOf(0, 0, 0), intArrayOf(0, 1, 0), intArrayOf(1, 1, 0)),
        1,
        arrayOf(
            arrayOf(intArrayOf(1, 0, 0), intArrayOf(0, -1, 0)),
            arrayOf(intArrayOf(-1, 0, 0), intArrayOf(0, -1, 0)),
            arrayOf(intArrayOf(-1, 0, 0), intArrayOf(0, 1, 0)),
            arrayOf(intArrayOf(1, 0, 0), intArrayOf(0, 1, 0)),
        ),
    ),
)

val AO_LEVELS = doubleArrayOf(0.5, 0.68, 0.84, 1.0)
private const val WATER_TOP_DROP = 0.15

private class Builder {
    private val vertices = ArrayList<Float>()
    private val indices = ArrayList<Int>()
    private var vertexCount = 0

    fun quad(pts: Array<DoubleArray>, n: IntArray, rgb: Rgb, alpha: Double, ao: IntArray) {
        for (i in 0 until 4) {
            val p = pts[i]
            val shade = AO_LEVELS[ao[i]]
            vertices.add(p[0].toFloat())
            vertices.add(p[1].toFloat())
            vertices.add(p[2].toFloat())
            vertices.add(n[0].toFloat())
            vertices.add(n[1].toFloat())
            vertices.add(n[2].toFloat())
            vertices.add((rgb.r * shade).toFloat())
            vertices.add((rgb.g * shade).toFloat())
            vertices.add((rgb.b * shade).toFloat())
            vertices.add(alpha.toFloat())
        }
        val b = vertexCount
        // flip the diagonal so AO interpolates without the classic seam artefact
        if (ao[0] + ao[2] > ao[1] + ao[3]) {
            indices.add(b); indices.add(b + 1); indices.add(b + 2)
            indices.add(b); indices.add(b + 2); indices.add(b + 3)
        } else {
            indices.add(b + 1); indices.add(b + 2); indices.add(b + 3)
            indices.add(b + 1); indices.add(b + 3); indices.add(b)
        }
        vertexCount += 4
    }

    fun build(): MeshData? {
        if (indices.isEmpty()) return null
        return MeshData(vertices.toFloatArray(), indices.toIntArray())
    }
}

/** Does a block occlude ambient light? (opaque-ish solids) */
private fun occludes(id: Int): Boolean =
    id != AIR && id != Block.WATER && id != Block.GLASS && !isProp(id)

private fun vertexAo(world: WorldStore, x: Int, y: Int, z: Int, n: IntArray, s1: IntArray, s2: IntArray): Int {
    val bx = x + n[0]
    val by = y + n[1]
    val bz = z + n[2]
    val side1 = if (occludes(world.getBlock(bx + s1[0], by + s1[1], bz + s1[2]))) 1 else 0
    val side2 = if (occludes(world.getBlock(bx + s2[0], by + s2[1], bz + s2[2]))) 1 else 0
    val corner = if (occludes(world.getBlock(bx + s1[0] + s2[0], by + s1[1] + s2[1], bz + s1[2] + s2[2]))) 1 else 0
    if (side1 == 1 && side2 == 1) return 0
    return 3 - (side1 + side2 + corner)
}

/** Should this face of `kind` be drawn against neighbour `nb`? */
fun faceVisible(kind: Int, nb: Int, isTop: Boolean): Boolean {
    if (nb != AIR && !(isSeeThrough(nb) && nb != kind)) return false
    if (kind == Block.WATER && !isTop && nb != AIR) return false
    return true
}

fun meshChunk(world: WorldStore, cx: Int, cy: Int, cz: Int): ChunkMesh {
    val chunk = world.getChunk(cx, cy, cz) ?: return ChunkMesh()
    val opaque = Builder()
    val translucent = Builder()
    val ox = cx * CHUNK_SIZE
    val oy = cy * CHUNK_SIZE
    val oz = cz * CHUNK_SIZE
    val ao = IntArray(4) { 3 }

    for (lx in 0 until CHUNK_SIZE) {
        for (ly in 0 until CHUNK_SIZE) {
            for (lz in 0 until CHUNK_SIZE) {
                val kind = chunk[(lx shl 8) or (ly shl 4) or lz].toInt() and 0xff
                if (kind == AIR || isProp(kind)) continue
                val x = ox + lx
                val y = oy + ly
                val z = oz + lz
                val def = blockDefs[kind]
                val target = if (isTranslucent(kind)) translucent else opaque
                for (face in FACES) {
                    val nb = world.getBlock(x + face.n[0], y + face.n[1], z + face.n[2])
                    val isTop = face.slot == 0
                    if (!faceVisible(kind, nb, isTop)) continue
                    val drop = if (kind == Block.WATER && isTop) WATER_TOP_DROP else 0.0
                    val pts = Array(4) { c ->
                        val corner = face.corners[c]
                        doubleArrayOf(
                            (x + corner[0]).toDouble(),
                            y + corner[1] - drop,
                            (z + corner[2]).toDouble(),
                        )
                    }
                    for (i in 0 until 4) {
                        ao[i] = vertexAo(world, x, y, z, face.n, face.ao[i][0], face.ao[i][1])
                    }
                    val colour = when (face.slot) {
                        0 -> def.top
                        2 -> def.bottom
                        else -> def.side
                    }
                    target.quad(pts, face.n, colour, def.alpha, ao)
                }
            }
        }
    }
    return ChunkMesh(opaque.build(), translucent.build())
}
