/**
 * What is under the ground (issue #25): caves to walk through and ore veins to find
 * in their walls. Before this the ground was solid stone from three blocks down to
 * bedrock, so the only ore in the world was inside the sky islands.
 *
 * Both halves are pure functions of (seed, x, y, z) like the rest of worldgen:
 *
 * - **Caves** are the intersection of two Perlin fields. A single field thresholded
 *   near zero gives sheets; two of them near zero at once gives the *line* where the
 *   sheets cross, which reads as a winding tunnel. Sampling is per voxel, so a chunk
 *   never has to know what its neighbours decided.
 * - **Veins** are placed per cell, not per voxel: space is cut into VEIN_CELL³ cells
 *   and each cell either holds one vein or does not, decided by a hash of the cell.
 *   The vein's blocks come from a short random walk out of its centre, seeded by that
 *   same hash, so a vein straddling a chunk border is built identically from either
 *   side. A chunk only has to look at the cells within VEIN_REACH of its bounds.
 */
import { hashInt, makeRng, PerlinNoise } from './noise.ts'
import { BLOCK } from './palette.ts'
import { ORES, type OreDef } from './ores.ts'
import { CHUNK, localIndex } from './chunkStore.ts'

// ---------------------------------------------------------------- caves
/** horizontal scale of the tunnel field; smaller = longer, lazier tunnels */
const CAVE_FREQ = 0.035
/** y is sampled faster than x/z, so tunnels run flatter than they climb */
const CAVE_SQUASH = 1.7
/** tunnel half-width just under the roof, and at its widest deep down */
const CAVE_MIN_R = 0.05
const CAVE_MAX_R = 0.105
/** depth over which a tunnel opens out from MIN to MAX */
const CAVE_WIDEN_OVER = 24
/** never break the surface: this many blocks of ground always stay above a tunnel */
export const CAVE_ROOF = 5
/** never touch bedrock or the layer resting on it */
export const CAVE_FLOOR = 2

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Where the tunnels are, for one world seed. */
export class CaveModel {
  private readonly a: PerlinNoise
  private readonly b: PerlinNoise
  /** no tunnel may come within this radius of the origin: the spawn pad stands on solid ground */
  private readonly padRadiusSq: number

  constructor(seed: number, padRadius: number) {
    this.a = new PerlinNoise(seed ^ 0xca7e5)
    this.b = new PerlinNoise(seed ^ 0x7c0a1)
    this.padRadiusSq = padRadius * padRadius
  }

  /** True where the ground should be hollow. `h` is the surface height of the column. */
  open(x: number, y: number, z: number, h: number): boolean {
    if (y <= CAVE_FLOOR || y > h - CAVE_ROOF) return false
    if (x * x + z * z <= this.padRadiusSq) return false
    const fx = x * CAVE_FREQ
    const fy = y * CAVE_FREQ * CAVE_SQUASH
    const fz = z * CAVE_FREQ
    const na = this.a.noise(fx, fy, fz)
    const nb = this.b.noise(fx, fy, fz)
    const t = clamp01((h - CAVE_ROOF - y) / CAVE_WIDEN_OVER)
    const r = CAVE_MIN_R + (CAVE_MAX_R - CAVE_MIN_R) * t
    return na * na + nb * nb < r * r
  }
}

// ---------------------------------------------------------------- ore veins
/** space is cut into cells this big; each holds at most one vein */
export const VEIN_CELL = 8
/** a vein's blocks never leave this box around its centre, so a chunk knows which cells can reach it */
export const VEIN_REACH = 5

const SALT_VEIN = 4001
/** lowest / highest y any ore band reaches — cells outside it are skipped without work */
const BAND_MIN = Math.min(...ORES.map(o => o.minY))
const BAND_MAX = Math.max(...ORES.map(o => o.maxY))
/** veins are memoised across the chunks that share them */
const VEIN_CACHE = 8192

export interface Vein {
  ore: OreDef
  /** centre, in world blocks */
  x: number
  y: number
  z: number
  /** the vein's blocks as offsets from the centre, flattened as x,y,z triples */
  offsets: Int8Array
}

/**
 * Cache key. This has to be exact, not a hash: two cells sharing a 32-bit hash would
 * hand one the other's vein, and which one won would depend on what the cache happened
 * to hold — worldgen would stop being a pure function of the seed. Same packing as
 * chunkStore's numKey, with room for ±2²⁰ cells across and the whole 0–127 band up.
 */
const CELL_HALF = 1 << 20
const CELL_SPAN = CELL_HALF * 2
const CELL_Y_HALF = 32
const cellKey = (gx: number, gy: number, gz: number): number =>
  ((gx + CELL_HALF) * CELL_SPAN + (gz + CELL_HALF)) * (CELL_Y_HALF * 2) + (gy + CELL_Y_HALF)

/**
 * The ore veins of one world. The cache belongs to the field, not the module: two
 * worlds open at once (a test, a handover) must not read each other's veins.
 */
export class VeinField {
  readonly seed: number
  private readonly cache = new Map<number, Vein | null>()

  constructor(seed: number) {
    this.seed = seed
  }

  /**
   * The vein held by one cell, or null. Everything about it — where its centre sits,
   * which ore it is, how big, and the walk that shapes it — comes out of one seeded
   * RNG, so it is the same vein whichever chunk asks for it.
   */
  in(gx: number, gy: number, gz: number): Vein | null {
    if (gy * VEIN_CELL > BAND_MAX || gy * VEIN_CELL + VEIN_CELL - 1 < BAND_MIN) return null
    const key = cellKey(gx, gy, gz)
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit
    const rng = makeRng(hashInt(this.seed ^ SALT_VEIN, gx, gy, gz))
    const x = gx * VEIN_CELL + rng.randint(0, VEIN_CELL - 1)
    const y = gy * VEIN_CELL + rng.randint(0, VEIN_CELL - 1)
    const z = gz * VEIN_CELL + rng.randint(0, VEIN_CELL - 1)
    const roll = rng.random()
    let acc = 0
    let ore: OreDef | null = null
    for (const o of ORES) {
      if (y < o.minY || y > o.maxY) continue
      acc += o.chance
      if (roll < acc) { ore = o; break }
    }
    const vein = ore ? { ore, x, y, z, offsets: walk(rng, rng.randint(ore.size[0], ore.size[1])) } : null
    if (this.cache.size >= VEIN_CACHE) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(key, vein)
    return vein
  }

  /** Every vein that can reach the block box [x0,x1] × [y0,y1] × [z0,z1], in cell order. */
  near(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Vein[] {
    const out: Vein[] = []
    const gx1 = Math.floor((x1 + VEIN_REACH) / VEIN_CELL)
    const gy1 = Math.floor((y1 + VEIN_REACH) / VEIN_CELL)
    const gz1 = Math.floor((z1 + VEIN_REACH) / VEIN_CELL)
    for (let gx = Math.floor((x0 - VEIN_REACH) / VEIN_CELL); gx <= gx1; gx++) {
      for (let gy = Math.floor((y0 - VEIN_REACH) / VEIN_CELL); gy <= gy1; gy++) {
        for (let gz = Math.floor((z0 - VEIN_REACH) / VEIN_CELL); gz <= gz1; gz++) {
          const v = this.in(gx, gy, gz)
          if (v) out.push(v)
        }
      }
    }
    return out
  }
}

/**
 * `count` blocks reached by stepping one axis at a time out of the centre, never leaving
 * the ±VEIN_REACH box. A step onto a block already taken is kept (the walk goes on from
 * there), which is what gives veins their clumped, un-wormlike look.
 */
function walk(rng: { randint(lo: number, hi: number): number }, count: number): Int8Array {
  const out = new Int8Array(count * 3)
  const seen = new Set<number>([0])
  let x = 0
  let y = 0
  let z = 0
  let n = 1
  for (let guard = 0; n < count && guard < count * 8; guard++) {
    const axis = rng.randint(0, 2)
    const step = rng.randint(0, 1) * 2 - 1
    const nx = x + (axis === 0 ? step : 0)
    const ny = y + (axis === 1 ? step : 0)
    const nz = z + (axis === 2 ? step : 0)
    if (Math.abs(nx) > VEIN_REACH || Math.abs(ny) > VEIN_REACH || Math.abs(nz) > VEIN_REACH) continue
    x = nx
    y = ny
    z = nz
    const k = ((x + VEIN_REACH) << 8) | ((y + VEIN_REACH) << 4) | (z + VEIN_REACH)
    if (seen.has(k)) continue
    seen.add(k)
    out[n * 3] = x
    out[n * 3 + 1] = y
    out[n * 3 + 2] = z
    n++
  }
  return n === count ? out : out.slice(0, n * 3)
}

/**
 * Write the veins into a chunk. Ore only ever replaces stone, so a vein is cut away
 * where a tunnel already went through it — which is exactly how a vein comes to be
 * showing in a cave wall — and never floats in the open or eats the soil above.
 */
export function stampVeins(data: Uint8Array, veinList: readonly Vein[], x0: number, y0: number, z0: number): boolean {
  let any = false
  for (const v of veinList) {
    const o = v.offsets
    for (let i = 0; i < o.length; i += 3) {
      const lx = v.x + o[i] - x0
      const ly = v.y + o[i + 1] - y0
      const lz = v.z + o[i + 2] - z0
      if (lx < 0 || lx >= CHUNK || ly < 0 || ly >= CHUNK || lz < 0 || lz >= CHUNK) continue
      const idx = localIndex(lx, ly, lz)
      if (data[idx] !== BLOCK.stone) continue
      data[idx] = v.ore.block
      any = true
    }
  }
  return any
}

/** true when a chunk's vertical band is entirely above every ore band */
export const aboveAllVeins = (y0: number): boolean => y0 > BAND_MAX + VEIN_REACH
