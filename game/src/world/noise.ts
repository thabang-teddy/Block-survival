/**
 * Seeded PRNG + 3-D Perlin noise. Stands in for Python's `random.Random(seed)` and
 * Blender's `mathutils.noise.noise` so the island generator is deterministic per seed.
 */

/** mulberry32 — small, fast, good enough for terrain. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Rng {
  random(): number
  /** inclusive on both ends, like Python's randint */
  randint(lo: number, hi: number): number
  shuffle<T>(arr: T[]): T[]
}

export function makeRng(seed: number): Rng {
  const next = createRng(seed)
  return {
    random: next,
    randint: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    shuffle<T>(arr: T[]): T[] {
      const out = arr.slice()
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const tmp = out[i]
        out[i] = out[j]
        out[j] = tmp
      }
      return out
    },
  }
}

const GRAD: readonly (readonly [number, number, number])[] = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
]

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)
const lerp = (a: number, b: number, t: number): number => a + t * (b - a)

/** Improved Perlin noise (Ken Perlin 2002) with a seeded permutation table. Output ≈ -1..1. */
export class PerlinNoise {
  private readonly perm = new Uint8Array(512)

  constructor(seed: number) {
    const p = new Uint8Array(256)
    for (let i = 0; i < 256; i++) p[i] = i
    const rng = createRng(seed)
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = p[i]
      p[i] = p[j]
      p[j] = tmp
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]
  }

  private grad(hash: number, x: number, y: number, z: number): number {
    const g = GRAD[hash % 12]
    return g[0] * x + g[1] * y + g[2] * z
  }

  noise(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    const Z = Math.floor(z) & 255
    x -= Math.floor(x)
    y -= Math.floor(y)
    z -= Math.floor(z)
    const u = fade(x)
    const v = fade(y)
    const w = fade(z)
    const p = this.perm
    const A = p[X] + Y
    const AA = p[A] + Z
    const AB = p[A + 1] + Z
    const B = p[X + 1] + Y
    const BA = p[B] + Z
    const BB = p[B + 1] + Z
    return lerp(
      lerp(
        lerp(this.grad(p[AA], x, y, z), this.grad(p[BA], x - 1, y, z), u),
        lerp(this.grad(p[AB], x, y - 1, z), this.grad(p[BB], x - 1, y - 1, z), u),
        v,
      ),
      lerp(
        lerp(this.grad(p[AA + 1], x, y, z - 1), this.grad(p[BA + 1], x - 1, y, z - 1), u),
        lerp(this.grad(p[AB + 1], x, y - 1, z - 1), this.grad(p[BB + 1], x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    )
  }
}
