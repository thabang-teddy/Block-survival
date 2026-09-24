/**
 * Sparse voxel world: 16³ chunks of Uint8 block ids keyed by chunk coordinate.
 * Coordinates are three.js space: x/z horizontal, y up. 1 voxel = 1 m.
 *
 * Two modes:
 * - **static** (tests, templates): `setBlock` allocates chunks on demand.
 * - **streamed** (the game): a `ChunkGenerator` produces any chunk on demand and columns
 *   are loaded / unloaded by the ChunkStreamer. Player edits are the source of truth:
 *   they stay resident in `edits` for the life of the world and are re-applied on top of
 *   the generated chunk whenever a column loads.
 */
import { AIR } from './palette.ts'

export const CHUNK = 16
const SHIFT = 4 // log2(CHUNK)
const MASK = CHUNK - 1

/** horizontal chunk range the numeric keys cover: ±2²⁰ chunks (±16 million blocks) */
const KEY_HALF = 1 << 20
const KEY_SPAN = KEY_HALF * 2
/** vertical chunk range: ±512 chunks (static worlds may go negative) */
const KEY_Y_HALF = 512
const KEY_Y_SPAN = KEY_Y_HALF * 2

export const chunkKey = (cx: number, cy: number, cz: number): string => `${cx},${cy},${cz}`
/** allocation-free chunk key for the hot getBlock path; fits in a safe integer (< 2⁵³) */
export const numKey = (cx: number, cy: number, cz: number): number =>
  ((cx + KEY_HALF) * KEY_SPAN + (cz + KEY_HALF)) * KEY_Y_SPAN + (cy + KEY_Y_HALF)
export const columnKey = (cx: number, cz: number): number => (cx + KEY_HALF) * KEY_SPAN + (cz + KEY_HALF)
export const columnFromKey = (key: number): { cx: number; cz: number } => ({
  cx: Math.floor(key / KEY_SPAN) - KEY_HALF,
  cz: (key % KEY_SPAN) - KEY_HALF,
})

export interface ChunkCoord {
  cx: number
  cy: number
  cz: number
}

export const toChunkCoord = (x: number, y: number, z: number): ChunkCoord => ({
  cx: x >> SHIFT,
  cy: y >> SHIFT,
  cz: z >> SHIFT,
})

export const localIndex = (x: number, y: number, z: number): number =>
  ((x & MASK) << 8) | ((y & MASK) << 4) | (z & MASK)

export const blockKey = (x: number, y: number, z: number): string => `${x},${y},${z}`

/** Extra data for prop blocks (torch, workbench, bed). */
export interface PropMeta {
  id: number
  x: number
  y: number
  z: number
  /** facing, multiples of π/2 */
  yaw: number
  /** for multi-cell props: the other cell; `primary` cells own the model */
  partner?: { x: number; y: number; z: number }
  primary: boolean
}

export interface Edit {
  x: number
  y: number
  z: number
  id: number
}

/** Produces the pristine contents of one chunk, or null when it is all air. */
export type ChunkGenerator = (cx: number, cy: number, cz: number) => Uint8Array | null

export class World {
  private readonly chunks = new Map<string, Uint8Array>()
  private readonly chunksByNum = new Map<number, Uint8Array>()
  private lastKey = NaN
  private lastChunk: Uint8Array | undefined
  private readonly dirty = new Set<string>()
  /** chunk keys whose data was dropped since the last takeRemoved() (renderer disposes them) */
  private removed: string[] = []
  private generator: ChunkGenerator | null = null
  /** streamed mode: number of chunks in the vertical band, cy 0 .. chunksY-1 */
  private chunksY = 0
  private readonly loadedColumns = new Set<number>()
  /** prop block metadata keyed by blockKey; bumps `propsVersion` on change */
  readonly props = new Map<string, PropMeta>()
  propsVersion = 0
  /** when true, every block change is recorded in `edits` (enable after generation) */
  trackEdits = false
  readonly edits = new Map<string, Edit>()
  private readonly editsByChunk = new Map<string, Map<string, Edit>>()

  /** Switch to streamed mode: chunks come from `generator`, columns via loadColumn(). */
  setGenerator(generator: ChunkGenerator, chunksY: number): void {
    this.generator = generator
    this.chunksY = chunksY
  }

  get isStreamed(): boolean {
    return this.generator !== null
  }

  getChunk(cx: number, cy: number, cz: number): Uint8Array | undefined {
    return this.chunks.get(chunkKey(cx, cy, cz))
  }

  chunkKeys(): IterableIterator<string> {
    return this.chunks.keys()
  }

  get chunkCount(): number {
    return this.chunks.size
  }

  get loadedColumnCount(): number {
    return this.loadedColumns.size
  }

  /** Static worlds count as fully loaded; streamed worlds only where a column was loaded. */
  isColumnLoaded(x: number, z: number): boolean {
    return !this.generator || this.loadedColumns.has(columnKey(x >> SHIFT, z >> SHIFT))
  }

  isChunkColumnLoaded(cx: number, cz: number): boolean {
    return !this.generator || this.loadedColumns.has(columnKey(cx, cz))
  }

  getBlock(x: number, y: number, z: number): number {
    const k = numKey(x >> SHIFT, y >> SHIFT, z >> SHIFT)
    let c: Uint8Array | undefined
    if (k === this.lastKey) c = this.lastChunk
    else {
      c = this.chunksByNum.get(k)
      this.lastKey = k
      this.lastChunk = c
    }
    return c ? c[localIndex(x, y, z)] : AIR
  }

  hasBlock(x: number, y: number, z: number): boolean {
    return this.getBlock(x, y, z) !== AIR
  }

  /**
   * Write a block and mark affected chunks dirty. Static mode allocates the chunk if
   * needed; streamed mode only records the edit when the column is not loaded (it is
   * applied when the column loads).
   */
  setBlock(x: number, y: number, z: number, id: number): void {
    const cx = x >> SHIFT
    const cy = y >> SHIFT
    const cz = z >> SHIFT
    const key = chunkKey(cx, cy, cz)
    const pk = blockKey(x, y, z)
    let c = this.chunks.get(key)
    if (!c) {
      if (this.generator && !this.loadedColumns.has(columnKey(cx, cz))) {
        if (this.props.delete(pk)) this.propsVersion++
        this.recordEdit(key, pk, x, y, z, id)
        return
      }
      if (id === AIR) return
      c = this.allocate(cx, cy, cz, key)
    }
    const i = localIndex(x, y, z)
    if (c[i] === id) return
    c[i] = id
    if (this.props.delete(pk)) this.propsVersion++
    this.recordEdit(key, pk, x, y, z, id)
    this.dirty.add(key)
    this.markNeighbourChunks(x, y, z, cx, cy, cz)
  }

  /** Place a prop block with its metadata (call after setBlock would have cleared old meta). */
  setProp(meta: PropMeta): void {
    this.setBlock(meta.x, meta.y, meta.z, meta.id)
    this.props.set(blockKey(meta.x, meta.y, meta.z), meta)
    this.propsVersion++
  }

  getProp(x: number, y: number, z: number): PropMeta | undefined {
    return this.props.get(blockKey(x, y, z))
  }

  /** Same as setBlock but never overwrites an existing block (Python's `if key not in vox`). */
  setBlockIfAir(x: number, y: number, z: number, id: number): void {
    if (this.getBlock(x, y, z) === AIR) this.setBlock(x, y, z, id)
  }

  /** Recorded edits inside one chunk (streamed mode re-applies these on load). */
  editsInChunk(cx: number, cy: number, cz: number): Iterable<Edit> {
    return this.editsByChunk.get(chunkKey(cx, cy, cz))?.values() ?? []
  }

  // ---------------------------------------------------------------- streaming
  /** Generate every chunk of a column, overlay its edits and mark it (and its neighbours) dirty. */
  loadColumn(cx: number, cz: number): void {
    const gen = this.generator
    if (!gen) throw new Error('World.loadColumn needs a generator')
    const col = columnKey(cx, cz)
    if (this.loadedColumns.has(col)) return
    this.loadedColumns.add(col)
    for (let cy = 0; cy < this.chunksY; cy++) {
      const key = chunkKey(cx, cy, cz)
      let data = gen(cx, cy, cz)
      const edits = this.editsByChunk.get(key)
      if (edits) {
        for (const e of edits.values()) {
          if (!data) {
            if (e.id === AIR) continue
            data = new Uint8Array(CHUNK * CHUNK * CHUNK)
          }
          data[localIndex(e.x, e.y, e.z)] = e.id
        }
      }
      if (!data) continue
      this.chunks.set(key, data)
      this.chunksByNum.set(numKey(cx, cy, cz), data)
      this.dirty.add(key)
    }
    this.lastKey = NaN
    // neighbours meshed against a missing column drew border faces; rebuild them
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      for (let cy = 0; cy < this.chunksY; cy++) this.dirtyIfExists(cx + dx, cy, cz + dz)
    }
  }

  /** Drop a column's chunk data; edits and props stay so a later load restores them. */
  unloadColumn(cx: number, cz: number): void {
    const col = columnKey(cx, cz)
    if (!this.loadedColumns.delete(col)) return
    for (let cy = 0; cy < this.chunksY; cy++) {
      const key = chunkKey(cx, cy, cz)
      if (!this.chunks.delete(key)) continue
      this.chunksByNum.delete(numKey(cx, cy, cz))
      this.dirty.delete(key)
      this.removed.push(key)
    }
    this.lastKey = NaN
  }

  /** Chunks whose data was dropped. Calling this clears the list. */
  takeRemoved(): string[] {
    const out = this.removed
    this.removed = []
    return out
  }

  /** Chunks whose mesh is stale. Calling this clears the set. */
  takeDirty(): string[] {
    const out = Array.from(this.dirty)
    this.dirty.clear()
    return out
  }

  markAllDirty(): void {
    for (const k of this.chunks.keys()) this.dirty.add(k)
  }

  // ---------------------------------------------------------------- internals
  private allocate(cx: number, cy: number, cz: number, key: string): Uint8Array {
    const c = new Uint8Array(CHUNK * CHUNK * CHUNK)
    this.chunks.set(key, c)
    this.chunksByNum.set(numKey(cx, cy, cz), c)
    this.lastKey = NaN
    return c
  }

  private recordEdit(chunk: string, pk: string, x: number, y: number, z: number, id: number): void {
    if (!this.trackEdits) return
    const e = { x, y, z, id }
    this.edits.set(pk, e)
    let perChunk = this.editsByChunk.get(chunk)
    if (!perChunk) {
      perChunk = new Map()
      this.editsByChunk.set(chunk, perChunk)
    }
    perChunk.set(pk, e)
  }

  private markNeighbourChunks(x: number, y: number, z: number, cx: number, cy: number, cz: number): void {
    const lx = x & MASK
    const ly = y & MASK
    const lz = z & MASK
    if (lx === 0) this.dirtyIfExists(cx - 1, cy, cz)
    if (lx === MASK) this.dirtyIfExists(cx + 1, cy, cz)
    if (ly === 0) this.dirtyIfExists(cx, cy - 1, cz)
    if (ly === MASK) this.dirtyIfExists(cx, cy + 1, cz)
    if (lz === 0) this.dirtyIfExists(cx, cy, cz - 1)
    if (lz === MASK) this.dirtyIfExists(cx, cy, cz + 1)
  }

  private dirtyIfExists(cx: number, cy: number, cz: number): void {
    const k = chunkKey(cx, cy, cz)
    if (this.chunks.has(k)) this.dirty.add(k)
  }
}
