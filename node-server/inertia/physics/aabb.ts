/**
 * Axis-aligned box vs voxel grid collision. Boxes are moved one axis at a time
 * and clamped against the first solid block they would enter.
 */
import type { World } from '../world/chunkStore.ts'
import { isSolid } from '../world/palette.ts'

export interface Box {
  /** min corner */
  x: number
  y: number
  z: number
  w: number // size on x
  h: number // size on y
  d: number // size on z
}

const EPS = 1e-4

export function boxIntersectsSolid(world: World, b: Box): boolean {
  const x0 = Math.floor(b.x + EPS)
  const x1 = Math.floor(b.x + b.w - EPS)
  const y0 = Math.floor(b.y + EPS)
  const y1 = Math.floor(b.y + b.h - EPS)
  const z0 = Math.floor(b.z + EPS)
  const z1 = Math.floor(b.z + b.d - EPS)
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        if (isSolid(world.getBlock(x, y, z))) return true
      }
    }
  }
  return false
}

export interface MoveResult {
  box: Box
  hitX: boolean
  hitY: boolean
  hitZ: boolean
}

/** Move `dist` along one axis (0=x,1=y,2=z); returns the clamped delta and whether it hit. */
function sweepAxis(world: World, b: Box, axis: 0 | 1 | 2, dist: number): { moved: number; hit: boolean } {
  if (dist === 0) return { moved: 0, hit: false }
  const min = [b.x, b.y, b.z]
  const size = [b.w, b.h, b.d]
  const sign = Math.sign(dist)
  // leading face position before and after the move
  const lead = sign > 0 ? min[axis] + size[axis] : min[axis]
  const target = lead + dist
  // range of voxel slices the leading face passes through
  const from = sign > 0 ? Math.floor(lead - EPS) + 1 : Math.floor(lead + EPS) - 1
  const to = sign > 0 ? Math.floor(target - EPS) : Math.floor(target + EPS)
  const oa = (axis + 1) % 3
  const ob = (axis + 2) % 3
  const a0 = Math.floor(min[oa] + EPS)
  const a1 = Math.floor(min[oa] + size[oa] - EPS)
  const b0 = Math.floor(min[ob] + EPS)
  const b1 = Math.floor(min[ob] + size[ob] - EPS)
  const coord = [0, 0, 0]
  for (let s = from; sign > 0 ? s <= to : s >= to; s += sign) {
    for (let a = a0; a <= a1; a++) {
      for (let c = b0; c <= b1; c++) {
        coord[axis] = s
        coord[oa] = a
        coord[ob] = c
        if (isSolid(world.getBlock(coord[0], coord[1], coord[2]))) {
          const wall = sign > 0 ? s : s + 1
          return { moved: wall - lead - sign * EPS, hit: true }
        }
      }
    }
  }
  return { moved: dist, hit: false }
}

export function moveBox(world: World, box: Box, dx: number, dy: number, dz: number): MoveResult {
  const b: Box = { ...box }
  const ry = sweepAxis(world, b, 1, dy)
  b.y += ry.moved
  const rx = sweepAxis(world, b, 0, dx)
  b.x += rx.moved
  const rz = sweepAxis(world, b, 2, dz)
  b.z += rz.moved
  return { box: b, hitX: rx.hit, hitY: ry.hit, hitZ: rz.hit }
}

/** Ray vs box (slab test). Returns the entry distance along the unit direction, or null. */
export function rayBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  b: Box,
): number | null {
  let tMin = 0
  let tMax = Infinity
  const mins = [b.x, b.y, b.z]
  const maxs = [b.x + b.w, b.y + b.h, b.z + b.d]
  const o = [ox, oy, oz]
  const d = [dx, dy, dz]
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mins[i] || o[i] > maxs[i]) return null
      continue
    }
    let t1 = (mins[i] - o[i]) / d[i]
    let t2 = (maxs[i] - o[i]) / d[i]
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t }
    tMin = Math.max(tMin, t1)
    tMax = Math.min(tMax, t2)
    if (tMin > tMax) return null
  }
  return tMin
}
