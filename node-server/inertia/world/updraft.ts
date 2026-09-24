/**
 * Updraft columns (issue #12): every floating island has one glowing shaft rising from
 * the ground to just above its rim. Standing in it lets the player rise, hover and sink
 * (see PlayerController). The shaft is a pure function of the island — seeded like
 * everything else — so host, clients and reloads agree on where it is.
 */
import type { PlacedIsland } from './islandField.ts'
import type { IslandTemplate } from './islandTemplate.ts'
import { AIR, BLOCK } from './palette.ts'

export interface Updraft {
  /** world x/z of the shaft axis (block centres) */
  x: number
  z: number
  /** the shaft lifts between these world heights (feet y) */
  bottomY: number
  topY: number
  radius: number
  /** the island it serves */
  ix: number
  iz: number
}

export const UPDRAFT = {
  radius: 1.25,
  /** blocks of clear air between the island's edge and the shaft axis */
  gap: 2,
  /** how far above the rim the lift keeps working, so you can step sideways onto grass */
  aboveRim: 3,
  rise: 6,
  sink: 4,
  /** m/s² towards the wanted vertical speed: ~0.15 s to full rise */
  accel: 40,
} as const

/** rim search order: east first, then the other cardinal directions */
const DIRECTIONS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
/** the strip of island-local columns that must be air around the shaft: axis ± 1, edge .. edge + 3 */
const STRIP_DEPTH = UPDRAFT.gap + 2
const STRIP_HALF_WIDTH = 1

/** no island block at all (shore, roots, trees) in this island-local column */
function columnIsClear(t: IslandTemplate, x: number, z: number): boolean {
  for (let y = t.minY; y <= t.maxY; y++) if (t.get(x, y, z) !== AIR) return false
  return true
}

/** highest ground-like block (not a tree) in an island-local column, or null */
function rimTop(t: IslandTemplate, x: number, z: number): number | null {
  for (let y = t.maxY; y >= t.minY; y--) {
    const id = t.get(x, y, z)
    if (id !== AIR && id !== BLOCK.log && id !== BLOCK.leaves) return y
  }
  return null
}

/**
 * The shaft for an island: walk outward from the centre until a strip of columns is
 * clear of the island, and put the axis `gap` blocks past the edge. `groundHeight` is
 * the ground surface at a world block.
 */
export function updraftFor(island: PlacedIsland, t: IslandTemplate, groundHeight: (x: number, z: number) => number): Updraft {
  const extent = Math.max(-t.minX, t.maxX, -t.minZ, t.maxZ) + 1
  for (const [ux, uz] of DIRECTIONS) {
    const px = -uz
    const pz = ux
    let rim: number | null = null // top of the last island column met on this ray
    for (let d = 0; d <= extent; d++) {
      const top = rimTop(t, d * ux, d * uz)
      if (top !== null) rim = top
      if (d === 0 || rim === null) continue
      let clear = true
      for (let k = 0; k < STRIP_DEPTH && clear; k++) {
        for (let m = -STRIP_HALF_WIDTH; m <= STRIP_HALF_WIDTH; m++) {
          if (!columnIsClear(t, (d + k) * ux + m * px, (d + k) * uz + m * pz)) { clear = false; break }
        }
      }
      if (!clear) continue
      const bx = island.x + (d + UPDRAFT.gap) * ux
      const bz = island.z + (d + UPDRAFT.gap) * uz
      return {
        x: bx + 0.5,
        z: bz + 0.5,
        bottomY: groundHeight(bx, bz) + 1,
        topY: island.baseY + rim + UPDRAFT.aboveRim,
        radius: UPDRAFT.radius,
        ix: island.ix,
        iz: island.iz,
      }
    }
  }
  throw new Error(`no clear rim for island ${island.ix},${island.iz}`)
}

/** the shaft the point is inside, if any */
export function updraftAt(shafts: readonly Updraft[], x: number, y: number, z: number): Updraft | null {
  for (const u of shafts) {
    if (y < u.bottomY || y > u.topY) continue
    const dx = x - u.x
    const dz = z - u.z
    if (dx * dx + dz * dz <= u.radius * u.radius) return u
  }
  return null
}
