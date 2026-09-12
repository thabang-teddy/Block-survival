/**
 * Sparse voxel world: 16³ chunks of Uint8 block ids keyed by chunk coordinate.
 * Coordinates are three.js space: x/z horizontal, y up. 1 voxel = 1 m.
 */
import { AIR } from './palette'

export const CHUNK = 16
const SHIFT = 4 // log2(CHUNK)
const MASK = CHUNK - 1

export const chunkKey = (cx: number, cy: number, cz: number): string => `${cx},${cy},${cz}`

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

export class World {
  private readonly chunks = new Map<string, Uint8Array>()
  private readonly dirty = new Set<string>()
  /** prop block metadata keyed by blockKey; bumps `propsVersion` on change */
  readonly props = new Map<string, PropMeta>()
  propsVersion = 0
  /** inclusive block-space bounds of everything ever written */
  readonly bounds = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, empty: true }

  getChunk(cx: number, cy: number, cz: number): Uint8Array | undefined {
    return this.chunks.get(chunkKey(cx, cy, cz))
  }

  chunkKeys(): IterableIterator<string> {
    return this.chunks.keys()
  }

  get chunkCount(): number {
    return this.chunks.size
  }

  getBlock(x: number, y: number, z: number): number {
    const c = this.chunks.get(chunkKey(x >> SHIFT, y >> SHIFT, z >> SHIFT))
    return c ? c[localIndex(x, y, z)] : AIR
  }

  hasBlock(x: number, y: number, z: number): boolean {
    return this.getBlock(x, y, z) !== AIR
  }

  /** Write a block, allocating the chunk if needed, and mark affected chunks dirty. */
  setBlock(x: number, y: number, z: number, id: number): void {
    const cx = x >> SHIFT
    const cy = y >> SHIFT
    const cz = z >> SHIFT
    const key = chunkKey(cx, cy, cz)
    let c = this.chunks.get(key)
    if (!c) {
      if (id === AIR) return
      c = new Uint8Array(CHUNK * CHUNK * CHUNK)
      this.chunks.set(key, c)
    }
    const i = localIndex(x, y, z)
    if (c[i] === id) return
    c[i] = id
    const pk = blockKey(x, y, z)
    if (this.props.delete(pk)) this.propsVersion++
    this.dirty.add(key)
    this.markNeighbourChunks(x, y, z, cx, cy, cz)
    this.growBounds(x, y, z)
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

  /** Chunks whose mesh is stale. Calling this clears the set. */
  takeDirty(): string[] {
    const out = Array.from(this.dirty)
    this.dirty.clear()
    return out
  }

  markAllDirty(): void {
    for (const k of this.chunks.keys()) this.dirty.add(k)
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

  private growBounds(x: number, y: number, z: number): void {
    const b = this.bounds
    if (b.empty) {
      b.minX = b.maxX = x
      b.minY = b.maxY = y
      b.minZ = b.maxZ = z
      b.empty = false
      return
    }
    if (x < b.minX) b.minX = x
    if (x > b.maxX) b.maxX = x
    if (y < b.minY) b.minY = y
    if (y > b.maxY) b.maxY = y
    if (z < b.minZ) b.minZ = z
    if (z > b.maxZ) b.maxZ = z
  }
}
