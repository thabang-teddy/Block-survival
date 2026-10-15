package com.blocksurvival.physics

import com.blocksurvival.world.JsMath.jsSign
import com.blocksurvival.world.WorldStore
import com.blocksurvival.world.isSolid
import kotlin.math.floor

/**
 * Axis-aligned box vs voxel grid collision — twin of `physics/aabb.ts`. Boxes
 * are moved one axis at a time and clamped against the first solid block they
 * would enter. Checked against `shared/fixtures/physics/aabb.json`.
 */
class Box(
    /** min corner */
    val x: Double,
    val y: Double,
    val z: Double,
    /** size on x, y, z */
    val w: Double,
    val h: Double,
    val d: Double,
) {
    fun moved(dx: Double, dy: Double, dz: Double): Box = Box(x + dx, y + dy, z + dz, w, h, d)
}

private const val EPS = 1e-4

fun boxIntersectsSolid(world: WorldStore, b: Box): Boolean {
    val x0 = floor(b.x + EPS).toInt()
    val x1 = floor(b.x + b.w - EPS).toInt()
    val y0 = floor(b.y + EPS).toInt()
    val y1 = floor(b.y + b.h - EPS).toInt()
    val z0 = floor(b.z + EPS).toInt()
    val z1 = floor(b.z + b.d - EPS).toInt()
    for (x in x0..x1) {
        for (y in y0..y1) {
            for (z in z0..z1) {
                if (isSolid(world.getBlock(x, y, z))) return true
            }
        }
    }
    return false
}

class MoveResult(val box: Box, val hitX: Boolean, val hitY: Boolean, val hitZ: Boolean)

/** Move `dist` along one axis (0 = x, 1 = y, 2 = z); the clamped delta and whether it hit. */
private fun sweepAxis(world: WorldStore, b: Box, axis: Int, dist: Double): Pair<Double, Boolean> {
    if (dist == 0.0) return 0.0 to false
    val min = doubleArrayOf(b.x, b.y, b.z)
    val size = doubleArrayOf(b.w, b.h, b.d)
    val sign = jsSign(dist)
    // leading face position before and after the move
    val lead = if (sign > 0) min[axis] + size[axis] else min[axis]
    val target = lead + dist
    // range of voxel slices the leading face passes through
    val from = if (sign > 0) floor(lead - EPS).toInt() + 1 else floor(lead + EPS).toInt() - 1
    val to = if (sign > 0) floor(target - EPS).toInt() else floor(target + EPS).toInt()
    val oa = (axis + 1) % 3
    val ob = (axis + 2) % 3
    val a0 = floor(min[oa] + EPS).toInt()
    val a1 = floor(min[oa] + size[oa] - EPS).toInt()
    val b0 = floor(min[ob] + EPS).toInt()
    val b1 = floor(min[ob] + size[ob] - EPS).toInt()
    val coord = intArrayOf(0, 0, 0)
    val step = sign.toInt()
    var s = from
    while (if (sign > 0) s <= to else s >= to) {
        for (a in a0..a1) {
            for (c in b0..b1) {
                coord[axis] = s
                coord[oa] = a
                coord[ob] = c
                if (isSolid(world.getBlock(coord[0], coord[1], coord[2]))) {
                    val wall = if (sign > 0) s else s + 1
                    return (wall - lead - sign * EPS) to true
                }
            }
        }
        s += step
    }
    return dist to false
}

fun moveBox(world: WorldStore, box: Box, dx: Double, dy: Double, dz: Double): MoveResult {
    var b = box
    val (my, hitY) = sweepAxis(world, b, 1, dy)
    b = b.moved(0.0, my, 0.0)
    val (mx, hitX) = sweepAxis(world, b, 0, dx)
    b = b.moved(mx, 0.0, 0.0)
    val (mz, hitZ) = sweepAxis(world, b, 2, dz)
    b = b.moved(0.0, 0.0, mz)
    return MoveResult(b, hitX, hitY, hitZ)
}

/** Ray vs box (slab test): the entry distance along the unit direction, or null. */
fun rayBox(ox: Double, oy: Double, oz: Double, dx: Double, dy: Double, dz: Double, b: Box): Double? {
    var tMin = 0.0
    var tMax = Double.POSITIVE_INFINITY
    val mins = doubleArrayOf(b.x, b.y, b.z)
    val maxs = doubleArrayOf(b.x + b.w, b.y + b.h, b.z + b.d)
    val o = doubleArrayOf(ox, oy, oz)
    val d = doubleArrayOf(dx, dy, dz)
    for (i in 0 until 3) {
        if (kotlin.math.abs(d[i]) < 1e-9) {
            if (o[i] < mins[i] || o[i] > maxs[i]) return null
            continue
        }
        var t1 = (mins[i] - o[i]) / d[i]
        var t2 = (maxs[i] - o[i]) / d[i]
        if (t1 > t2) {
            val t = t1
            t1 = t2
            t2 = t
        }
        if (t1 > tMin) tMin = t1
        if (t2 < tMax) tMax = t2
        if (tMin > tMax) return null
    }
    return tMin
}
