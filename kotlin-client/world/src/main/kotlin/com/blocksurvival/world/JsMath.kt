package com.blocksurvival.world

import kotlin.math.floor
import kotlin.math.sqrt

/**
 * JavaScript number semantics the world generator depends on — twin of
 * `client/lib/world/js_math.dart` and the V8 behaviour behind
 * `server/resources/js/world`. Every operation whose result could differ
 * between V8 and the JVM is spelled out here rather than mapped to the nearest
 * `kotlin.math` call. Verified by `shared/fixtures/worldgen/primitives.json`.
 *
 * Integer ops run on [Long] (64-bit, like a Dart native `int`), never [Int]:
 * `imul`'s intermediate product overflows 32 bits, and `(largeDouble).toInt()`
 * saturates on the JVM where a 64-bit truncation does not — the Perlin z-slice
 * bug the Unity port documented (docs/PLAN.md §P1).
 */
object JsMath {
    const val JS_PI: Double = Math.PI

    /** JS bitwise ops work on 32-bit values. */
    fun u32(x: Long): Long = x and 0xFFFFFFFFL

    /** `x | 0` — ToInt32. */
    fun i32(x: Long): Long = (u32(x) xor 0x80000000L) - 0x80000000L

    /**
     * `Math.imul(a, b)` as an unsigned 32-bit value. Both operands are masked to
     * 32 bits; the full product's low 32 bits are what survive, and they depend
     * only on the operands' low 32 bits, so the 64-bit multiply wrapping is
     * irrelevant after the mask — identical to Dart's native-int behaviour.
     */
    fun imul(a: Long, b: Long): Long = u32(u32(a) * u32(b))

    /** `x >>> n` on a 32-bit value. */
    fun ushr(x: Long, n: Int): Long = u32(x) shr n

    /** `Math.round`: halfway cases go towards +∞ (not away from zero). */
    fun jsRound(x: Double): Long {
        val f = floor(x)
        return (if (x - f >= 0.5) f + 1 else f).toLong()
    }

    /** `Math.round` where the result is known to fit a 32-bit height/coordinate. */
    fun jsRoundI(x: Double): Int = jsRound(x).toInt()

    /** `Math.trunc` for finite input (64-bit, like Dart's `.truncate()`). */
    fun jsTrunc(x: Double): Long = x.toLong()

    fun jsTruncI(x: Double): Int = x.toLong().toInt()

    /** -1, 0 or 1 for finite doubles (0 stays 0). */
    fun jsSign(x: Double): Double = if (x > 0) 1.0 else if (x < 0) -1.0 else 0.0

    /** `Math.hypot(x, z)` exactly as V8 computes it (scale by max, Kahan-sum). */
    fun hypot(x: Double, z: Double): Double = hypotN(doubleArrayOf(x, z))

    /** three-argument form (raycast direction length) */
    fun hypot3(x: Double, y: Double, z: Double): Double = hypotN(doubleArrayOf(x, y, z))

    fun hypotN(values: DoubleArray): Double {
        var max = 0.0
        var anyNaN = false
        val abs = DoubleArray(values.size)
        for (i in values.indices) {
            val v = values[i]
            if (v.isNaN()) {
                anyNaN = true
                continue
            }
            val a = kotlin.math.abs(v)
            abs[i] = a
            if (a > max) max = a
        }
        if (max == Double.POSITIVE_INFINITY) return Double.POSITIVE_INFINITY
        if (anyNaN) return Double.NaN
        if (max == 0.0) return 0.0
        var sum = 0.0
        var compensation = 0.0
        for (a in abs) {
            val n = a / max
            val summand = n * n - compensation
            val preliminary = sum + summand
            compensation = (preliminary - sum) - summand
            sum = preliminary
        }
        return sqrt(sum) * max
    }

    // -----------------------------------------------------------------------
    // fdlibm sin / cos — the implementation behind V8's Math.sin / Math.cos
    // (v8/src/base/ieee754.cc). Platform libms are each within an ulp but not
    // identical; the island generator rounds cos(angle)*dist to pick the lake.
    // -----------------------------------------------------------------------

    private fun highWord(x: Double): Int = (java.lang.Double.doubleToRawLongBits(x) ushr 32).toInt()

    private fun fromWords(high: Int, low: Long): Double {
        val bits = (high.toLong() shl 32) or (low and 0xFFFFFFFFL)
        return java.lang.Double.longBitsToDouble(bits)
    }

    private const val S1 = -1.66666666666666324348e-01
    private const val S2 = 8.33333333332248946124e-03
    private const val S3 = -1.98412698298579493134e-04
    private const val S4 = 2.75573137070700676789e-06
    private const val S5 = -2.50507602534068634195e-08
    private const val S6 = 1.58969099521155010221e-10

    private fun kernelSin(x: Double, y: Double, iy: Boolean): Double {
        val ix = highWord(x) and 0x7fffffff
        if (ix < 0x3e400000) {
            if (x.toInt() == 0) return x
        }
        val z = x * x
        val v = z * x
        val r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))
        if (!iy) return x + v * (S1 + z * r)
        return x - ((z * (0.5 * y - v * r) - y) - v * S1)
    }

    private const val C1 = 4.16666666666666019037e-02
    private const val C2 = -1.38888888888741095749e-03
    private const val C3 = 2.48015872894767294178e-05
    private const val C4 = -2.75573143513906633035e-07
    private const val C5 = 2.08757232129817482790e-09
    private const val C6 = -1.13596475577881948265e-11

    private fun kernelCos(x: Double, y: Double): Double {
        val ix = highWord(x) and 0x7fffffff
        if (ix < 0x3e400000) {
            if (x.toInt() == 0) return 1.0
        }
        val z = x * x
        val r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))
        if (ix < 0x3FD33333) return 1.0 - (0.5 * z - (z * r - x * y))
        val qx = if (ix > 0x3fe90000) 0.28125 else fromWords(ix - 0x00200000, 0)
        val hz = 0.5 * z - qx
        val a = 1.0 - qx
        return a - (hz - (z * r - x * y))
    }

    private val NPIO2_HW = intArrayOf(
        0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C,
        0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C,
        0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A,
        0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
        0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
        0x404858EB, 0x404921FB,
    )

    private const val INVPIO2 = 6.36619772367581382433e-01
    private const val PIO2_1 = 1.57079632673412561417e+00
    private const val PIO2_1T = 6.07710050650619224932e-11
    private const val PIO2_2 = 6.07710050630396597660e-11
    private const val PIO2_2T = 2.02226624879595063154e-21
    private const val PIO2_3 = 2.02226624871116645580e-21
    private const val PIO2_3T = 8.47842766036889956997e-32

    /**
     * `__ieee754_rem_pio2` for |x| up to 2^19·π/2, which covers every angle the
     * generator produces. Returns n; y[0], y[1] = x mod π/2.
     */
    private fun remPio2(x: Double, y: DoubleArray): Int {
        val hx = highWord(x)
        val ix = hx and 0x7fffffff
        if (ix <= 0x3fe921fb) {
            y[0] = x
            y[1] = 0.0
            return 0
        }
        if (ix < 0x4002d97c) {
            if (hx > 0) {
                var z = x - PIO2_1
                if (ix != 0x3ff921fb) {
                    y[0] = z - PIO2_1T
                    y[1] = (z - y[0]) - PIO2_1T
                } else {
                    z -= PIO2_2
                    y[0] = z - PIO2_2T
                    y[1] = (z - y[0]) - PIO2_2T
                }
                return 1
            }
            var z = x + PIO2_1
            if (ix != 0x3ff921fb) {
                y[0] = z + PIO2_1T
                y[1] = (z - y[0]) + PIO2_1T
            } else {
                z += PIO2_2
                y[0] = z + PIO2_2T
                y[1] = (z - y[0]) + PIO2_2T
            }
            return -1
        }
        if (ix > 0x413921fb) {
            throw IllegalArgumentException("fdlibm port only covers |x| <= 2^19 * pi/2, got $x")
        }
        var t = kotlin.math.abs(x)
        val n = (t * INVPIO2 + 0.5).toInt()
        val fn = n.toDouble()
        var r = t - fn * PIO2_1
        var w = fn * PIO2_1T
        if (n < 32 && ix != NPIO2_HW[n - 1]) {
            y[0] = r - w
        } else {
            val j = ix shr 20
            y[0] = r - w
            var i = j - ((highWord(y[0]) shr 20) and 0x7ff)
            if (i > 16) {
                t = r
                w = fn * PIO2_2
                r = t - w
                w = fn * PIO2_2T - ((t - r) - w)
                y[0] = r - w
                i = j - ((highWord(y[0]) shr 20) and 0x7ff)
                if (i > 49) {
                    t = r
                    w = fn * PIO2_3
                    r = t - w
                    w = fn * PIO2_3T - ((t - r) - w)
                    y[0] = r - w
                }
            }
        }
        y[1] = (r - y[0]) - w
        if (hx < 0) {
            y[0] = -y[0]
            y[1] = -y[1]
            return -n
        }
        return n
    }

    /** `Math.sin` as V8 computes it. */
    fun jsSin(x: Double): Double {
        val ix = highWord(x) and 0x7fffffff
        if (ix <= 0x3fe921fb) return kernelSin(x, 0.0, false)
        if (ix >= 0x7ff00000) return x - x
        val y = DoubleArray(2)
        val n = remPio2(x, y)
        return when (n and 3) {
            0 -> kernelSin(y[0], y[1], true)
            1 -> kernelCos(y[0], y[1])
            2 -> -kernelSin(y[0], y[1], true)
            else -> -kernelCos(y[0], y[1])
        }
    }

    /** `Math.cos` as V8 computes it. */
    fun jsCos(x: Double): Double {
        val ix = highWord(x) and 0x7fffffff
        if (ix <= 0x3fe921fb) return kernelCos(x, 0.0)
        if (ix >= 0x7ff00000) return x - x
        val y = DoubleArray(2)
        val n = remPio2(x, y)
        return when (n and 3) {
            0 -> kernelCos(y[0], y[1])
            1 -> -kernelSin(y[0], y[1], true)
            2 -> -kernelCos(y[0], y[1])
            else -> kernelSin(y[0], y[1], true)
        }
    }
}
