/**
 * The endless ground layer: a heightmap of rolling hills with occasional cliffs, sea
 * level water, a flat spawn pad at the origin and per-column deterministic trees.
 * Everything here is a pure function of (seed, x, z) so any chunk can be generated
 * in isolation and in any order.
 */
import { BLOCK } from './palette.ts'
import { fractal2, hash01, PerlinNoise } from './noise.ts'

export const SEA_LEVEL = 32
export const GROUND_MIN = 24
export const GROUND_MAX = 52
/** radius of the flat grass pad the player starts on */
export const PAD_RADIUS = 8
/** blocks over which the pad eases into the natural terrain */
export const PAD_BLEND = 4
/** no water inside this radius of the origin */
export const DRY_RADIUS = 16
export const TREE_DENSITY = 0.006
/** two trees are never within this Chebyshev distance of each other */
export const TREE_SPACING = 3
export const TREE_MIN_HEIGHT = 4
export const TREE_MAX_HEIGHT = 6

const SALT = { tree: 101, treeHeight: 102 } as const
const SLICE = { broad: 11, detail: 12, ridge: 13 } as const

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const smoothstep = (t: number): number => t * t * (3 - 2 * t)

export class GroundModel {
  readonly seed: number
  /** y of the spawn pad's top block */
  readonly padHeight: number
  private readonly n2: (x: number, z: number, seed: number, freq: number) => number

  constructor(seed: number) {
    this.seed = seed
    this.n2 = fractal2(new PerlinNoise(seed ^ 0x5eed))
    this.padHeight = this.computePadHeight()
  }

  /** terrain height before the pad and dry zone are applied */
  naturalHeight(x: number, z: number): number {
    const broad = this.n2(x, z, this.seed + SLICE.broad, 0.011)
    const detail = this.n2(x, z, this.seed + SLICE.detail, 0.045)
    const ridge = this.n2(x, z, this.seed + SLICE.ridge, 0.02)
    let h = 36 + 9 * broad + 2.5 * detail
    // cliffs: a steep 9-block step where the ridge noise peaks
    if (ridge > 0.55) h += Math.min(1, (ridge - 0.55) * 4) * 9
    return clamp(Math.round(h), GROUND_MIN, GROUND_MAX)
  }

  /** height of the top block of a column */
  height(x: number, z: number): number {
    const d = Math.hypot(x, z)
    if (d <= PAD_RADIUS) return this.padHeight
    // keep the spawn area dry: the minimum height ramps down away from the origin
    const nat = Math.max(this.naturalHeight(x, z), Math.ceil(SEA_LEVEL + 2 - Math.max(0, d - DRY_RADIUS)))
    if (d > PAD_RADIUS + PAD_BLEND) return nat
    const t = smoothstep((d - PAD_RADIUS) / PAD_BLEND)
    return Math.round(this.padHeight + (nat - this.padHeight) * t)
  }

  static surfaceFor(h: number): number {
    return h <= SEA_LEVEL + 1 ? BLOCK.sand : BLOCK.grass
  }

  /**
   * Trunk height of the tree rooted at this column, or 0. Trees grow on grass away
   * from water and the pad; when two candidates are within TREE_SPACING the one with
   * the lower hash wins, so the decision is the same from every chunk.
   */
  treeHeight(x: number, z: number, heightAt: (x: number, z: number) => number): number {
    const r = hash01(this.seed, x, z, SALT.tree)
    if (r >= TREE_DENSITY) return 0
    if (GroundModel.surfaceFor(heightAt(x, z)) !== BLOCK.grass) return 0
    if (Math.hypot(x, z) <= PAD_RADIUS + PAD_BLEND + 2) return 0
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (heightAt(x + dx, z + dz) < SEA_LEVEL) return 0
      }
    }
    for (let dx = -TREE_SPACING; dx <= TREE_SPACING; dx++) {
      for (let dz = -TREE_SPACING; dz <= TREE_SPACING; dz++) {
        if (!dx && !dz) continue
        const r2 = hash01(this.seed, x + dx, z + dz, SALT.tree)
        if (r2 < TREE_DENSITY && (r2 < r || (r2 === r && (dx < 0 || (dx === 0 && dz < 0))))) return 0
      }
    }
    return TREE_MIN_HEIGHT + Math.floor(hash01(this.seed, x, z, SALT.treeHeight) * (TREE_MAX_HEIGHT - TREE_MIN_HEIGHT + 1))
  }

  /** median natural height of the ring just outside the pad, never flooded */
  private computePadHeight(): number {
    const ring: number[] = []
    const outer = PAD_RADIUS + 3
    for (let x = -outer; x <= outer; x++) {
      for (let z = -outer; z <= outer; z++) {
        const d = Math.hypot(x, z)
        if (d > PAD_RADIUS && d <= outer) ring.push(this.naturalHeight(x, z))
      }
    }
    ring.sort((a, b) => a - b)
    return Math.max(SEA_LEVEL + 2, ring[ring.length >> 1])
  }
}
