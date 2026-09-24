/**
 * Where the floating islands are. The sky is divided into ISLAND_CELL-metre cells;
 * each cell hashes (seed, ix, iz) to decide whether it holds an island, where inside
 * the cell it sits, how high it floats and which island params it uses. Islands never
 * leave their cell, so they never overlap. Cell (0, 0) is the legacy island: the
 * original Island_Large, floating over the spawn pad so old saves keep their builds.
 */
import { ISLAND_LARGE, type IslandParams } from './islandGen.ts'
import { IslandTemplate } from './islandTemplate.ts'
import { hash01, hashInt } from './noise.ts'

export const ISLAND_CELL = 96
export const ISLAND_CHANCE = 0.5
/** lowest grass layer of a generated island floats between these heights */
export const ISLAND_MIN_Y = 80
export const ISLAND_MAX_Y = 96
export const LEGACY_ISLAND_Y = 80
/** widest island plus the room its trees need; centres stay this far inside their cell */
const MAX_HALF_EXTENT = 33
/** templates kept in memory; islands beyond that are regenerated when needed */
const TEMPLATE_CACHE = 48

const SALT = { exists: 1, offsetX: 2, offsetZ: 3, size: 4, height: 5, depth: 6, lake: 7, seed: 8, baseY: 9 } as const

export interface PlacedIsland {
  ix: number
  iz: number
  /** world x/z of the island centre */
  x: number
  z: number
  /** world y of the island's lowest grass layer (template y = 0) */
  baseY: number
  params: IslandParams
}

/** The island in a sky cell, or null for an empty cell. Pure in (seed, ix, iz). */
export function islandAtCell(seed: number, ix: number, iz: number): PlacedIsland | null {
  if (ix === 0 && iz === 0) return { ix, iz, x: 0, z: 0, baseY: LEGACY_ISLAND_Y, params: ISLAND_LARGE }
  if (hash01(seed, ix, iz, SALT.exists) >= ISLAND_CHANCE) return null
  const size = 24 + 2 * Math.floor(hash01(seed, ix, iz, SALT.size) * 17) // 24..56, even
  const maxJitter = ISLAND_CELL / 2 - MAX_HALF_EXTENT
  const jx = (hash01(seed, ix, iz, SALT.offsetX) * 2 - 1) * maxJitter
  const jz = (hash01(seed, ix, iz, SALT.offsetZ) * 2 - 1) * maxJitter
  return {
    ix, iz,
    x: Math.round(ix * ISLAND_CELL + ISLAND_CELL / 2 + jx),
    z: Math.round(iz * ISLAND_CELL + ISLAND_CELL / 2 + jz),
    baseY: ISLAND_MIN_Y + Math.floor(hash01(seed, ix, iz, SALT.baseY) * (ISLAND_MAX_Y - ISLAND_MIN_Y + 1)),
    params: {
      size,
      seed: hashInt(seed, ix, iz, SALT.seed),
      maxHeight: 5 + Math.floor(hash01(seed, ix, iz, SALT.height) * 5), // 5..9
      depth: 9 + Math.floor(hash01(seed, ix, iz, SALT.depth) * 8), // 9..16
      padRadius: 0,
      lake: hash01(seed, ix, iz, SALT.lake) < 0.4,
      treeDensity: 0.022,
    },
  }
}

/** Islands whose footprint may overlap the block range [x0, x1] × [z0, z1]. */
export function islandsNear(seed: number, x0: number, z0: number, x1: number, z1: number): PlacedIsland[] {
  const out: PlacedIsland[] = []
  const ix0 = Math.floor((x0 - MAX_HALF_EXTENT) / ISLAND_CELL)
  const ix1 = Math.floor((x1 + MAX_HALF_EXTENT) / ISLAND_CELL)
  const iz0 = Math.floor((z0 - MAX_HALF_EXTENT) / ISLAND_CELL)
  const iz1 = Math.floor((z1 + MAX_HALF_EXTENT) / ISLAND_CELL)
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iz = iz0; iz <= iz1; iz++) {
      const island = islandAtCell(seed, ix, iz)
      if (!island) continue
      if (island.x + MAX_HALF_EXTENT < x0 || island.x - MAX_HALF_EXTENT > x1) continue
      if (island.z + MAX_HALF_EXTENT < z0 || island.z - MAX_HALF_EXTENT > z1) continue
      out.push(island)
    }
  }
  return out
}

/** Memoised island templates (generation is ~10 ms for a large island). */
export class IslandTemplates {
  private readonly cache = new Map<string, IslandTemplate>()

  get(island: PlacedIsland): IslandTemplate {
    const key = `${island.ix},${island.iz}`
    let t = this.cache.get(key)
    if (t) {
      // refresh LRU position
      this.cache.delete(key)
      this.cache.set(key, t)
      return t
    }
    t = new IslandTemplate(island.params)
    if (this.cache.size >= TEMPLATE_CACHE) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(key, t)
    return t
  }
}
