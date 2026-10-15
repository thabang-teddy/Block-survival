package com.blocksurvival.world

import com.blocksurvival.world.JsMath.imul
import com.blocksurvival.world.JsMath.u32
import com.blocksurvival.world.JsMath.ushr
import kotlin.math.floor

/**
 * Seeded PRNG + 3-D Perlin noise — twin of `server/resources/js/world/noise.ts`
 * (via `client/lib/world/noise.dart`). Integer arithmetic runs on [Long] 32-bit
 * values; see [JsMath].
 */

/** mulberry32; returns doubles in [0, 1). */
typealias RandomFn = () -> Double

fun createRng(seed: Long): RandomFn {
    var a = u32(seed)
    return {
        a = u32(a + 0x6d2b79f5L)
        var t = a
        t = imul(t xor ushr(t, 15), t or 1L)
        t = t xor (t + imul(t xor ushr(t, 7), t or 61L))
        u32(t xor ushr(t, 14)).toDouble() / 4294967296.0
    }
}

class Rng(seed: Long) {
    private val nextFn: RandomFn = createRng(seed)

    fun random(): Double = nextFn()

    /** inclusive on both ends, like Python's randint */
    fun randint(lo: Int, hi: Int): Int = lo + floor(nextFn() * (hi - lo + 1)).toInt()

    fun <T> shuffle(arr: List<T>): List<T> {
        val out = ArrayList(arr)
        for (i in out.size - 1 downTo 1) {
            val j = floor(nextFn() * (i + 1)).toInt()
            val tmp = out[i]
            out[i] = out[j]
            out[j] = tmp
        }
        return out
    }
}

/** Deterministic 32-bit hash of up to four ints (murmur3-style finaliser). */
fun hashInt(a: Long, b: Long = 0, c: Long = 0, d: Long = 0): Long {
    var h = imul(a, 0x9e3779b1L) xor 0x85ebca6bL
    h = imul(h xor ushr(h, 15), 0x2c1b3c6dL) xor imul(b, 0x27d4eb2fL)
    h = imul(h xor ushr(h, 13), 0x165667b1L) xor imul(c, 0x9e3779b1L)
    h = imul(h xor ushr(h, 16), 0x85ebca6bL) xor imul(d, 0xc2b2ae35L)
    h = h xor ushr(h, 13)
    h = imul(h, 0x27d4eb2fL)
    return u32(h xor ushr(h, 16))
}

/** hashInt scaled to [0, 1) */
fun hash01(a: Long, b: Long = 0, c: Long = 0, d: Long = 0): Double =
    hashInt(a, b, c, d).toDouble() / 4294967296.0

private val GRAD = arrayOf(
    intArrayOf(1, 1, 0), intArrayOf(-1, 1, 0), intArrayOf(1, -1, 0), intArrayOf(-1, -1, 0),
    intArrayOf(1, 0, 1), intArrayOf(-1, 0, 1), intArrayOf(1, 0, -1), intArrayOf(-1, 0, -1),
    intArrayOf(0, 1, 1), intArrayOf(0, -1, 1), intArrayOf(0, 1, -1), intArrayOf(0, -1, -1),
)

private fun fade(t: Double): Double = t * t * t * (t * (t * 6 - 15) + 10)
private fun lerp(a: Double, b: Double, t: Double): Double = a + t * (b - a)

/** Improved Perlin noise with a seeded permutation table. Output ≈ -1..1. */
class PerlinNoise(seed: Long) {
    private val perm = IntArray(512)

    init {
        val p = IntArray(256) { it }
        val rng = createRng(seed)
        for (i in 255 downTo 1) {
            val j = floor(rng() * (i + 1)).toInt()
            val tmp = p[i]
            p[i] = p[j]
            p[j] = tmp
        }
        for (i in 0 until 512) perm[i] = p[i and 255]
    }

    private fun gradAt(hash: Int, x: Double, y: Double, z: Double): Double {
        val g = GRAD[hash % 12]
        return g[0] * x + g[1] * y + g[2] * z
    }

    fun noise(xIn: Double, yIn: Double, zIn: Double): Double {
        var x = xIn
        var y = yIn
        var z = zIn
        val fx = floor(x)
        val fy = floor(y)
        val fz = floor(z)
        // 64-bit truncation before masking: the fractal2 z-slice (seed * 7.31,
        // where seed can be a ~4.3-billion hashInt output) overflows Int.
        val xi = (fx.toLong() and 255L).toInt()
        val yi = (fy.toLong() and 255L).toInt()
        val zi = (fz.toLong() and 255L).toInt()
        x -= fx
        y -= fy
        z -= fz
        val u = fade(x)
        val v = fade(y)
        val w = fade(z)
        val p = perm
        val a = p[xi] + yi
        val aa = p[a] + zi
        val ab = p[a + 1] + zi
        val b = p[xi + 1] + yi
        val ba = p[b] + zi
        val bb = p[b + 1] + zi
        return lerp(
            lerp(
                lerp(gradAt(p[aa], x, y, z), gradAt(p[ba], x - 1, y, z), u),
                lerp(gradAt(p[ab], x, y - 1, z), gradAt(p[bb], x - 1, y - 1, z), u),
                v,
            ),
            lerp(
                lerp(gradAt(p[aa + 1], x, y, z - 1), gradAt(p[ba + 1], x - 1, y, z - 1), u),
                lerp(gradAt(p[ab + 1], x, y - 1, z - 1), gradAt(p[bb + 1], x - 1, y - 1, z - 1), u),
                v,
            ),
            w,
        )
    }
}

/** 2-D fractal noise in roughly -1.5..1.5; `seed` picks a slice. */
typealias Fractal2 = (x: Double, z: Double, seed: Double, freq: Double) -> Double

fun fractal2(perlin: PerlinNoise): Fractal2 = { x, z, seed, freq ->
    val vx = x * freq
    val vz = z * freq
    val vs = seed * 7.31
    perlin.noise(vx, vz, vs) + 0.5 * perlin.noise(vx * 2.1 + 3.3, vz * 2.1 + 1.7, vs * 2.1)
}
