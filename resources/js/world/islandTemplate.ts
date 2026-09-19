/**
 * A floating island generated once (by the unchanged islands.py port) into a dense
 * block template, then stamped into any chunk it overlaps. Templates are pure
 * functions of their params, so chunks that read them are order-independent.
 */
import { AIR } from './palette'
import { generateIsland, type IslandParams, type VoxelSink } from './islandGen'

/** room around the nominal radius for the noisy mask and tree canopies */
const XZ_MARGIN = 5
/** the island hangs up to ~depth × 1.5 below y = 0; peaks + trees reach maxHeight + ~11 above */
const Y_BELOW = 12
const Y_ABOVE = 16

export class IslandTemplate implements VoxelSink {
  /** tight bounds of the non-air blocks, island-local (origin = centre, y 0 = lowest grass layer) */
  minX = Infinity
  minY = Infinity
  minZ = Infinity
  maxX = -Infinity
  maxY = -Infinity
  maxZ = -Infinity
  /** y of the build pad's top block (only meaningful when params.padRadius > 0) */
  readonly padHeight: number
  voxelCount = 0
  private readonly ext: number
  private readonly yLo: number
  private readonly yHi: number
  private readonly sx: number
  private readonly sy: number
  private readonly data: Uint8Array

  constructor(params: IslandParams) {
    this.ext = Math.trunc(params.size / 2) + XZ_MARGIN
    this.yLo = -(params.depth + Y_BELOW)
    this.yHi = params.maxHeight + Y_ABOVE
    this.sx = this.ext * 2 + 1
    this.sy = this.yHi - this.yLo + 1
    this.data = new Uint8Array(this.sx * this.sy * this.sx)
    this.padHeight = generateIsland(this, params).padHeight
  }

  /** block at island-local coordinates; AIR outside the template */
  get(x: number, y: number, z: number): number {
    if (x < this.minX || x > this.maxX || y < this.minY || y > this.maxY || z < this.minZ || z > this.maxZ) return AIR
    return this.data[this.index(x, y, z)]
  }

  getBlock(x: number, y: number, z: number): number {
    if (!this.inside(x, y, z)) return AIR
    return this.data[this.index(x, y, z)]
  }

  setBlock(x: number, y: number, z: number, id: number): void {
    if (!this.inside(x, y, z)) throw new Error(`island block ${x},${y},${z} outside its template`)
    const i = this.index(x, y, z)
    if (this.data[i] === AIR && id !== AIR) this.voxelCount++
    this.data[i] = id
    if (id === AIR) return
    if (x < this.minX) this.minX = x
    if (x > this.maxX) this.maxX = x
    if (y < this.minY) this.minY = y
    if (y > this.maxY) this.maxY = y
    if (z < this.minZ) this.minZ = z
    if (z > this.maxZ) this.maxZ = z
  }

  setBlockIfAir(x: number, y: number, z: number, id: number): void {
    if (this.getBlock(x, y, z) === AIR) this.setBlock(x, y, z, id)
  }

  private inside(x: number, y: number, z: number): boolean {
    return x >= -this.ext && x <= this.ext && z >= -this.ext && z <= this.ext && y >= this.yLo && y <= this.yHi
  }

  private index(x: number, y: number, z: number): number {
    return ((z + this.ext) * this.sy + (y - this.yLo)) * this.sx + (x + this.ext)
  }
}
