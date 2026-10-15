package com.blocksurvival.world

import com.blocksurvival.world.JsMath.u32
import kotlin.math.abs
import kotlin.math.floor

/**
 * What is under the ground (issue #25) — twin of
 * `server/resources/js/world/underground.ts`: caves (the intersection of two
 * Perlin fields) and ore veins (placed per cell, grown by a seeded walk).
 */

// ---------------------------------------------------------------- caves
private const val CAVE_FREQ = 0.035
private const val CAVE_SQUASH = 1.7
private const val CAVE_MIN_R = 0.05
private const val CAVE_MAX_R = 0.105
private const val CAVE_WIDEN_OVER = 24.0

/** never break the surface: this many blocks of ground always stay above a tunnel */
const val CAVE_ROOF = 5

/** never touch bedrock or the layer resting on it */
const val CAVE_FLOOR = 2

private fun clamp01(v: Double): Double = if (v < 0) 0.0 else if (v > 1) 1.0 else v

/** Where the tunnels are, for one world seed. */
class CaveModel(seed: Long, padRadius: Double) {
    private val a = PerlinNoise(u32(seed xor 0xca7e5L))
    private val b = PerlinNoise(u32(seed xor 0x7c0a1L))
    private val padRadiusSq = padRadius * padRadius

    /** True where the ground should be hollow. [h] is the surface height of the column. */
    fun open(x: Int, y: Int, z: Int, h: Int): Boolean {
        if (y <= CAVE_FLOOR || y > h - CAVE_ROOF) return false
        if ((x.toDouble() * x + z.toDouble() * z) <= padRadiusSq) return false
        val fx = x * CAVE_FREQ
        val fy = y * CAVE_FREQ * CAVE_SQUASH
        val fz = z * CAVE_FREQ
        val na = a.noise(fx, fy, fz)
        val nb = b.noise(fx, fy, fz)
        val t = clamp01((h - CAVE_ROOF - y) / CAVE_WIDEN_OVER)
        val r = CAVE_MIN_R + (CAVE_MAX_R - CAVE_MIN_R) * t
        return na * na + nb * nb < r * r
    }
}

// ---------------------------------------------------------------- ore veins
/** space is cut into cells this big; each holds at most one vein */
const val VEIN_CELL = 8

/** a vein's blocks never leave this box around its centre */
const val VEIN_REACH = 5

private const val SALT_VEIN = 4001L
private const val VEIN_CACHE = 8192

private val bandMin = ores.minOf { it.minY }
private val bandMax = ores.maxOf { it.maxY }

class Vein(
    val ore: OreDef,
    /** centre, in world blocks */
    val x: Int,
    val y: Int,
    val z: Int,
    /** the vein's blocks as offsets from the centre, flattened as x,y,z triples */
    val offsets: ByteArray,
)

/** The ore veins of one world. */
class VeinField(val seed: Long) {
    private val cache = LinkedHashMap<String, Vein?>()

    fun inCell(gx: Long, gy: Long, gz: Long): Vein? {
        if (gy * VEIN_CELL > bandMax || gy * VEIN_CELL + VEIN_CELL - 1 < bandMin) return null
        val key = "$gx,$gy,$gz"
        if (cache.containsKey(key)) return cache[key]
        val rng = Rng(hashInt(u32(seed xor SALT_VEIN), gx, gy, gz))
        val x = (gx * VEIN_CELL + rng.randint(0, VEIN_CELL - 1)).toInt()
        val y = (gy * VEIN_CELL + rng.randint(0, VEIN_CELL - 1)).toInt()
        val z = (gz * VEIN_CELL + rng.randint(0, VEIN_CELL - 1)).toInt()
        val roll = rng.random()
        var acc = 0.0
        var ore: OreDef? = null
        for (o in ores) {
            if (y < o.minY || y > o.maxY) continue
            acc += o.chance
            if (roll < acc) {
                ore = o
                break
            }
        }
        val found = ore
        val vein = if (found == null) null
        else Vein(found, x, y, z, walk(rng, rng.randint(found.sizeMin, found.sizeMax)))
        if (cache.size >= VEIN_CACHE) cache.remove(cache.keys.iterator().next())
        cache[key] = vein
        return vein
    }

    /** Every vein that can reach the block box [x0,x1] × [y0,y1] × [z0,z1], in cell order. */
    fun near(x0: Int, y0: Int, z0: Int, x1: Int, y1: Int, z1: Int): List<Vein> {
        val out = ArrayList<Vein>()
        val gx1 = floor((x1 + VEIN_REACH).toDouble() / VEIN_CELL).toLong()
        val gy1 = floor((y1 + VEIN_REACH).toDouble() / VEIN_CELL).toLong()
        val gz1 = floor((z1 + VEIN_REACH).toDouble() / VEIN_CELL).toLong()
        var gx = floor((x0 - VEIN_REACH).toDouble() / VEIN_CELL).toLong()
        while (gx <= gx1) {
            var gy = floor((y0 - VEIN_REACH).toDouble() / VEIN_CELL).toLong()
            while (gy <= gy1) {
                var gz = floor((z0 - VEIN_REACH).toDouble() / VEIN_CELL).toLong()
                while (gz <= gz1) {
                    val v = inCell(gx, gy, gz)
                    if (v != null) out.add(v)
                    gz++
                }
                gy++
            }
            gx++
        }
        return out
    }
}

/**
 * [count] blocks reached by stepping one axis at a time out of the centre,
 * never leaving the ±VEIN_REACH box. A step onto a block already taken is kept.
 */
private fun walk(rng: Rng, count: Int): ByteArray {
    val out = ByteArray(count * 3)
    val seen = HashSet<Int>()
    seen.add(0)
    var x = 0
    var y = 0
    var z = 0
    var n = 1
    for (guard in 0 until count * 8) {
        if (n >= count) break
        val axis = rng.randint(0, 2)
        val step = rng.randint(0, 1) * 2 - 1
        val nx = x + if (axis == 0) step else 0
        val ny = y + if (axis == 1) step else 0
        val nz = z + if (axis == 2) step else 0
        if (abs(nx) > VEIN_REACH || abs(ny) > VEIN_REACH || abs(nz) > VEIN_REACH) continue
        x = nx
        y = ny
        z = nz
        val k = ((x + VEIN_REACH) shl 8) or ((y + VEIN_REACH) shl 4) or (z + VEIN_REACH)
        if (seen.contains(k)) continue
        seen.add(k)
        out[n * 3] = x.toByte()
        out[n * 3 + 1] = y.toByte()
        out[n * 3 + 2] = z.toByte()
        n++
    }
    return if (n == count) out else out.copyOfRange(0, n * 3)
}

/**
 * Write the veins into a chunk. Ore only ever replaces stone, so a vein is cut
 * away where a tunnel already went through it.
 */
fun stampVeins(data: ByteArray, veins: List<Vein>, x0: Int, y0: Int, z0: Int): Boolean {
    var any = false
    for (v in veins) {
        val o = v.offsets
        for (i in o.indices step 3) {
            val lx = v.x + o[i] - x0
            val ly = v.y + o[i + 1] - y0
            val lz = v.z + o[i + 2] - z0
            if (lx < 0 || lx >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue
            val idx = localIndex(lx, ly, lz)
            if ((data[idx].toInt() and 0xff) != Block.STONE) continue
            data[idx] = v.ore.block.toByte()
            any = true
        }
    }
    return any
}

/** true when a chunk's vertical band is entirely above every ore band */
fun aboveAllVeins(y0: Int): Boolean = y0 > bandMax + VEIN_REACH
