package com.blocksurvival.world

import com.blocksurvival.world.JsMath.hypot
import com.blocksurvival.world.JsMath.jsRoundI
import kotlin.math.ceil
import kotlin.math.floor

/**
 * The endless ground layer — twin of `server/resources/js/world/groundGen.ts`.
 * Everything is a pure function of (seed, x, z).
 */
const val SEA_LEVEL = 32
const val GROUND_MIN = 24
const val GROUND_MAX = 52

/** radius of the flat grass pad the player starts on */
const val PAD_RADIUS = 8

/** blocks over which the pad eases into the natural terrain */
const val PAD_BLEND = 4

/** no water inside this radius of the origin */
const val DRY_RADIUS = 16
const val TREE_DENSITY = 0.006

/** two trees are never within this Chebyshev distance of each other */
const val TREE_SPACING = 3
const val TREE_MIN_HEIGHT = 4
const val TREE_MAX_HEIGHT = 6

private const val SALT_TREE = 101L
private const val SALT_TREE_HEIGHT = 102L
private const val SLICE_BROAD = 11
private const val SLICE_DETAIL = 12
private const val SLICE_RIDGE = 13

private fun clampInt(v: Int, lo: Int, hi: Int): Int = if (v < lo) lo else if (v > hi) hi else v
private fun smoothstep(t: Double): Double = t * t * (3 - 2 * t)

typealias HeightAt = (x: Int, z: Int) -> Int

class GroundModel(val seed: Long) {
    private val n2: Fractal2 = fractal2(PerlinNoise(seed xor 0x5eedL))

    /** y of the spawn pad's top block */
    val padHeight: Int = computePadHeight()

    /** terrain height before the pad and dry zone are applied */
    fun naturalHeight(x: Int, z: Int): Int {
        val xd = x.toDouble()
        val zd = z.toDouble()
        val broad = n2(xd, zd, (seed + SLICE_BROAD).toDouble(), 0.011)
        val detail = n2(xd, zd, (seed + SLICE_DETAIL).toDouble(), 0.045)
        val ridge = n2(xd, zd, (seed + SLICE_RIDGE).toDouble(), 0.02)
        var h = 36 + 9 * broad + 2.5 * detail
        // cliffs: a steep 9-block step where the ridge noise peaks
        if (ridge > 0.55) {
            val step = (ridge - 0.55) * 4
            h += (if (step < 1) step else 1.0) * 9
        }
        return clampInt(jsRoundI(h), GROUND_MIN, GROUND_MAX)
    }

    /** height of the top block of a column */
    fun height(x: Int, z: Int): Int {
        val d = hypot(x.toDouble(), z.toDouble())
        if (d <= PAD_RADIUS) return padHeight
        // keep the spawn area dry: the minimum height ramps down away from the origin
        val away = d - DRY_RADIUS
        val floorH = ceil(SEA_LEVEL + 2 - (if (away > 0) away else 0.0)).toInt()
        val natural = naturalHeight(x, z)
        val nat = if (natural > floorH) natural else floorH
        if (d > PAD_RADIUS + PAD_BLEND) return nat
        val t = smoothstep((d - PAD_RADIUS) / PAD_BLEND)
        return jsRoundI(padHeight + (nat - padHeight) * t)
    }

    /** Trunk height of the tree rooted at this column, or 0. */
    fun treeHeight(x: Int, z: Int, heightAt: HeightAt): Int {
        val r = hash01(seed, x.toLong(), z.toLong(), SALT_TREE)
        if (r >= TREE_DENSITY) return 0
        if (surfaceFor(heightAt(x, z)) != Block.GRASS) return 0
        if (hypot(x.toDouble(), z.toDouble()) <= PAD_RADIUS + PAD_BLEND + 2) return 0
        for (dx in -2..2) {
            for (dz in -2..2) {
                if (heightAt(x + dx, z + dz) < SEA_LEVEL) return 0
            }
        }
        for (dx in -TREE_SPACING..TREE_SPACING) {
            for (dz in -TREE_SPACING..TREE_SPACING) {
                if (dx == 0 && dz == 0) continue
                val r2 = hash01(seed, (x + dx).toLong(), (z + dz).toLong(), SALT_TREE)
                if (r2 < TREE_DENSITY &&
                    (r2 < r || (r2 == r && (dx < 0 || (dx == 0 && dz < 0))))
                ) {
                    return 0
                }
            }
        }
        return TREE_MIN_HEIGHT +
            floor(hash01(seed, x.toLong(), z.toLong(), SALT_TREE_HEIGHT) * (TREE_MAX_HEIGHT - TREE_MIN_HEIGHT + 1)).toInt()
    }

    /** median natural height of the ring just outside the pad, never flooded */
    private fun computePadHeight(): Int {
        val ring = ArrayList<Int>()
        val outer = PAD_RADIUS + 3
        for (x in -outer..outer) {
            for (z in -outer..outer) {
                val d = hypot(x.toDouble(), z.toDouble())
                if (d > PAD_RADIUS && d <= outer) ring.add(naturalHeight(x, z))
            }
        }
        ring.sort()
        val median = ring[ring.size shr 1]
        return if (median > SEA_LEVEL + 2) median else SEA_LEVEL + 2
    }

    companion object {
        fun surfaceFor(h: Int): Int = if (h <= SEA_LEVEL + 1) Block.SAND else Block.GRASS
    }
}
