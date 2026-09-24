/**
 * DDA voxel raycast (Amanatides & Woo). Returns the first non-air block hit
 * within `maxDist`, with the face normal the ray entered through.
 */
import type { World } from './chunkStore.ts'
import { AIR, BLOCK } from './palette.ts'

export interface RayHit {
  x: number
  y: number
  z: number
  /** face normal of the entered face; place a block at (x,y,z)+normal */
  nx: number
  ny: number
  nz: number
  distance: number
  block: number
}

export function raycastVoxels(
  world: World,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
  ignoreWater = true,
): RayHit | null {
  const len = Math.hypot(dx, dy, dz)
  if (len === 0) return null
  dx /= len; dy /= len; dz /= len

  let x = Math.floor(ox)
  let y = Math.floor(oy)
  let z = Math.floor(oz)
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity
  let tMaxX = stepX > 0 ? (x + 1 - ox) / dx : stepX < 0 ? (x - ox) / dx : Infinity
  let tMaxY = stepY > 0 ? (y + 1 - oy) / dy : stepY < 0 ? (y - oy) / dy : Infinity
  let tMaxZ = stepZ > 0 ? (z + 1 - oz) / dz : stepZ < 0 ? (z - oz) / dz : Infinity

  let nx = 0, ny = 0, nz = 0
  let t = 0
  // guard against starting inside a block: we still report it with a zero normal
  for (let i = 0; i < 512; i++) {
    const block = world.getBlock(x, y, z)
    if (block !== AIR && !(ignoreWater && block === BLOCK.water)) {
      return { x, y, z, nx, ny, nz, distance: t, block }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      t = tMaxX; tMaxX += tDeltaX; x += stepX; nx = -stepX; ny = 0; nz = 0
    } else if (tMaxY < tMaxZ) {
      t = tMaxY; tMaxY += tDeltaY; y += stepY; nx = 0; ny = -stepY; nz = 0
    } else {
      t = tMaxZ; tMaxZ += tDeltaZ; z += stepZ; nx = 0; ny = 0; nz = -stepZ
    }
    if (t > maxDist) return null
  }
  return null
}
