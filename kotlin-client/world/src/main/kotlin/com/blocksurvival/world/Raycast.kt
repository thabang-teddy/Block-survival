package com.blocksurvival.world

import com.blocksurvival.world.JsMath.hypot3
import kotlin.math.abs
import kotlin.math.floor

/**
 * DDA voxel raycast (Amanatides & Woo) — twin of `world/raycast.ts`. The first
 * non-air block hit within `maxDist`, with the face normal the ray entered
 * through. Checked against `shared/fixtures/physics/raycast.json`.
 */
class RayHit(
    val x: Int,
    val y: Int,
    val z: Int,
    /** face normal of the entered face; place a block at (x, y, z) + normal */
    val nx: Int,
    val ny: Int,
    val nz: Int,
    val distance: Double,
    val block: Int,
)

fun raycastVoxels(
    world: WorldStore,
    ox: Double,
    oy: Double,
    oz: Double,
    dxIn: Double,
    dyIn: Double,
    dzIn: Double,
    maxDist: Double,
    ignoreWater: Boolean = true,
): RayHit? {
    var dx = dxIn
    var dy = dyIn
    var dz = dzIn
    val len = hypot3(dx, dy, dz)
    if (len == 0.0) return null
    dx /= len
    dy /= len
    dz /= len

    var x = floor(ox).toInt()
    var y = floor(oy).toInt()
    var z = floor(oz).toInt()
    val stepX = if (dx > 0) 1 else if (dx < 0) -1 else 0
    val stepY = if (dy > 0) 1 else if (dy < 0) -1 else 0
    val stepZ = if (dz > 0) 1 else if (dz < 0) -1 else 0
    val tDeltaX = if (stepX != 0) abs(1 / dx) else Double.POSITIVE_INFINITY
    val tDeltaY = if (stepY != 0) abs(1 / dy) else Double.POSITIVE_INFINITY
    val tDeltaZ = if (stepZ != 0) abs(1 / dz) else Double.POSITIVE_INFINITY
    var tMaxX = if (stepX > 0) (x + 1 - ox) / dx else if (stepX < 0) (x - ox) / dx else Double.POSITIVE_INFINITY
    var tMaxY = if (stepY > 0) (y + 1 - oy) / dy else if (stepY < 0) (y - oy) / dy else Double.POSITIVE_INFINITY
    var tMaxZ = if (stepZ > 0) (z + 1 - oz) / dz else if (stepZ < 0) (z - oz) / dz else Double.POSITIVE_INFINITY

    var nx = 0
    var ny = 0
    var nz = 0
    var t = 0.0
    // starting inside a block still reports it, with a zero normal
    for (i in 0 until 512) {
        val block = world.getBlock(x, y, z)
        if (block != AIR && !(ignoreWater && block == Block.WATER)) {
            return RayHit(x, y, z, nx, ny, nz, t, block)
        }
        if (tMaxX < tMaxY && tMaxX < tMaxZ) {
            t = tMaxX
            tMaxX += tDeltaX
            x += stepX
            nx = -stepX
            ny = 0
            nz = 0
        } else if (tMaxY < tMaxZ) {
            t = tMaxY
            tMaxY += tDeltaY
            y += stepY
            nx = 0
            ny = -stepY
            nz = 0
        } else {
            t = tMaxZ
            tMaxZ += tDeltaZ
            z += stepZ
            nx = 0
            ny = 0
            nz = -stepZ
        }
        if (t > maxDist) return null
    }
    return null
}
