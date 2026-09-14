/**
 * Per-chunk world generation: endless ground (groundGen) with floating islands
 * (islandField) stamped over it. `generateChunk` depends only on (seed, cx, cy, cz):
 * column data and island templates are memoised but never mutated, so chunks come
 * out identical whatever order they are requested in.
 */
import { CHUNK, localIndex } from './chunkStore'
import { AIR, BLOCK } from './palette'
import { GroundModel, SEA_LEVEL, TREE_MAX_HEIGHT } from './groundGen'
import { islandsNear, IslandTemplates, type PlacedIsland } from './islandField'
import type { IslandTemplate } from './islandTemplate'
import { updraftFor, type Updraft } from './updraft'

/** vertical band of the world: chunks cy 0 .. WORLD_CHUNKS_Y-1 (y 0..127) */
export const WORLD_CHUNKS_Y = 8
export const WORLD_HEIGHT = WORLD_CHUNKS_Y * CHUNK
/** columns evaluated around a chunk so trees straddling its border are complete */
const BORDER = 4
const CANOPY = 2
const COLS = CHUNK + 2 * BORDER
/** column blocks kept; each is 24×24 heights + tree table */
const COLUMN_CACHE = 512
/** a shaft sits at most this far from its island's centre (half extent + margin + gap) */
const UPDRAFT_REACH = 8

export interface Spawn {
  x: number
  y: number
  z: number
}

/** heights / surfaces / trees for a chunk column plus a BORDER ring around it */
interface ColumnBlock {
  h: Int16Array
  tree: Uint8Array
  /** highest non-air block any ground column here can produce */
  maxY: number
  islands: { island: PlacedIsland; template: IslandTemplate }[]
}

export class TerrainGenerator {
  readonly seed: number
  readonly ground: GroundModel
  private readonly templates = new IslandTemplates()
  private readonly columns = new Map<string, ColumnBlock>()
  private readonly updrafts = new Map<string, Updraft>()

  constructor(seed: number) {
    this.seed = seed
    this.ground = new GroundModel(seed)
  }

  /** where a new player stands: on the centre of the spawn pad */
  spawn(): Spawn {
    return { x: 0.5, y: this.ground.padHeight + 1, z: 0.5 }
  }

  /** the updraft shaft of an island (memoised; a pure function of the island) */
  updraftOf(island: PlacedIsland): Updraft {
    const key = `${island.ix},${island.iz}`
    let u = this.updrafts.get(key)
    if (!u) {
      u = updraftFor(island, this.templates.get(island), (x, z) => this.ground.height(x, z))
      this.updrafts.set(key, u)
    }
    return u
  }

  /** shafts whose axis lies inside the block range [x0, x1] × [z0, z1] */
  updraftsNear(x0: number, z0: number, x1: number, z1: number): Updraft[] {
    const out: Updraft[] = []
    for (const island of islandsNear(this.seed, x0 - UPDRAFT_REACH, z0 - UPDRAFT_REACH, x1 + UPDRAFT_REACH, z1 + UPDRAFT_REACH)) {
      const u = this.updraftOf(island)
      if (u.x >= x0 && u.x <= x1 + 1 && u.z >= z0 && u.z <= z1 + 1) out.push(u)
    }
    return out
  }

  /** The pristine contents of a chunk, or null when it is all air. */
  generateChunk(cx: number, cy: number, cz: number): Uint8Array | null {
    if (cy < 0 || cy >= WORLD_CHUNKS_Y) return null
    const col = this.columnBlock(cx, cz)
    const y0 = cy * CHUNK
    const y1 = y0 + CHUNK - 1
    const islands = col.islands.filter(({ island, template }) => island.baseY + template.minY <= y1 && island.baseY + template.maxY >= y0)
    if (y0 > col.maxY && !islands.length) return null

    const data = new Uint8Array(CHUNK * CHUNK * CHUNK)
    let any = false
    const x0 = cx * CHUNK
    const z0 = cz * CHUNK
    for (let lx = 0; lx < CHUNK; lx++) {
      for (let lz = 0; lz < CHUNK; lz++) {
        const h = col.h[(lx + BORDER) * COLS + lz + BORDER]
        for (let ly = 0; ly < CHUNK; ly++) {
          const id = groundBlock(y0 + ly, h)
          if (id === AIR) continue
          data[localIndex(lx, ly, lz)] = id
          any = true
        }
      }
    }
    if (col.maxY >= y0) any = stampTrees(data, col, y0) || any
    for (const { island, template } of islands) {
      any = stampIsland(data, template, x0 - island.x, y0 - island.baseY, z0 - island.z) || any
    }
    return any ? data : null
  }

  private columnBlock(cx: number, cz: number): ColumnBlock {
    const key = `${cx},${cz}`
    const cached = this.columns.get(key)
    if (cached) return cached
    const x0 = cx * CHUNK - BORDER
    const z0 = cz * CHUNK - BORDER
    const h = new Int16Array(COLS * COLS)
    let maxY = SEA_LEVEL
    for (let i = 0; i < COLS; i++) {
      for (let j = 0; j < COLS; j++) {
        const v = this.ground.height(x0 + i, z0 + j)
        h[i * COLS + j] = v
        if (v > maxY) maxY = v
      }
    }
    const heightAt = (x: number, z: number): number => {
      const i = x - x0
      const j = z - z0
      return i >= 0 && i < COLS && j >= 0 && j < COLS ? h[i * COLS + j] : this.ground.height(x, z)
    }
    const tree = new Uint8Array(COLS * COLS)
    for (let i = CANOPY; i < COLS - CANOPY; i++) {
      for (let j = CANOPY; j < COLS - CANOPY; j++) {
        tree[i * COLS + j] = this.ground.treeHeight(x0 + i, z0 + j, heightAt)
      }
    }
    const block: ColumnBlock = {
      h, tree, maxY: maxY + TREE_MAX_HEIGHT + 2,
      islands: islandsNear(this.seed, cx * CHUNK, cz * CHUNK, cx * CHUNK + CHUNK - 1, cz * CHUNK + CHUNK - 1)
        .map(island => ({ island, template: this.templates.get(island) })),
    }
    if (this.columns.size >= COLUMN_CACHE) this.columns.delete(this.columns.keys().next().value!)
    this.columns.set(key, block)
    return block
  }
}

/** ground column layering: bedrock, stone, 3 dirt, surface, water up to sea level */
function groundBlock(y: number, h: number): number {
  if (y === 0) return BLOCK.bedrock
  if (y <= h - 4) return BLOCK.stone
  if (y <= h - 1) return BLOCK.dirt
  if (y === h) return GroundModel.surfaceFor(h)
  if (y <= SEA_LEVEL) return BLOCK.water
  return AIR
}

/** Trunks first, then leaves into air only, so overlapping canopies resolve the same way from every chunk. */
function stampTrees(data: Uint8Array, col: ColumnBlock, y0: number): boolean {
  let any = false
  const put = (lx: number, y: number, lz: number, id: number, onlyAir: boolean): void => {
    if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < y0 || y >= y0 + CHUNK) return
    const i = localIndex(lx, y - y0, lz)
    if (onlyAir && data[i] !== AIR) return
    data[i] = id
    any = true
  }
  const trees: { lx: number; lz: number; base: number; height: number }[] = []
  for (let i = BORDER - CANOPY; i < COLS - BORDER + CANOPY; i++) {
    for (let j = BORDER - CANOPY; j < COLS - BORDER + CANOPY; j++) {
      const height = col.tree[i * COLS + j]
      if (height) trees.push({ lx: i - BORDER, lz: j - BORDER, base: col.h[i * COLS + j] + 1, height })
    }
  }
  for (const t of trees) for (let dy = 0; dy < t.height; dy++) put(t.lx, t.base + dy, t.lz, BLOCK.log, false)
  for (const t of trees) {
    const top = t.base + t.height
    for (let dy = -2; dy < 2; dy++) {
      const r = dy < 0 ? 2 : 1
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && dy !== -1) continue
          put(t.lx + dx, top + dy, t.lz + dz, BLOCK.leaves, true)
        }
      }
    }
    put(t.lx, top + 2, t.lz, BLOCK.leaves, true)
  }
  return any
}

/** Copy the template's non-air blocks over the chunk; `ox/oy/oz` = chunk origin in island-local space. */
function stampIsland(data: Uint8Array, t: IslandTemplate, ox: number, oy: number, oz: number): boolean {
  let any = false
  const lx0 = Math.max(0, t.minX - ox)
  const lx1 = Math.min(CHUNK - 1, t.maxX - ox)
  const lz0 = Math.max(0, t.minZ - oz)
  const lz1 = Math.min(CHUNK - 1, t.maxZ - oz)
  const ly0 = Math.max(0, t.minY - oy)
  const ly1 = Math.min(CHUNK - 1, t.maxY - oy)
  for (let lx = lx0; lx <= lx1; lx++) {
    for (let lz = lz0; lz <= lz1; lz++) {
      for (let ly = ly0; ly <= ly1; ly++) {
        const id = t.get(ox + lx, oy + ly, oz + lz)
        if (id === AIR) continue
        data[localIndex(lx, ly, lz)] = id
        any = true
      }
    }
  }
  return any
}

const generators = new Map<number, TerrainGenerator>()
/** Convenience for one-off calls; the Game keeps its own TerrainGenerator. */
function generatorFor(seed: number): TerrainGenerator {
  let g = generators.get(seed)
  if (!g) {
    g = new TerrainGenerator(seed)
    generators.set(seed, g)
  }
  return g
}

export const generateChunk = (seed: number, cx: number, cy: number, cz: number): Uint8Array | null =>
  generatorFor(seed).generateChunk(cx, cy, cz)

/** feet position on the spawn pad for a world seed */
export const groundSpawn = (seed: number): Spawn => generatorFor(seed).spawn()
