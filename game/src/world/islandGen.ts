/**
 * Floating voxel island — port of Design/blender_scripts/islands.py `generate_island`.
 *
 * Blender is z-up; here the horizontal plane is (x, z) and height is y.
 * Origin = island centre, y = 0 is the lowest grass layer, the island hangs below.
 */
import { BLOCK } from './palette'
import { makeRng, PerlinNoise, type Rng } from './noise'
import type { World } from './chunkStore'

export interface IslandParams {
  size: number
  seed: number
  maxHeight: number
  depth: number
  padRadius: number
  lake: boolean
  treeDensity: number
}

/** Island_Large from islands.py ISLANDS table. */
export const ISLAND_LARGE: IslandParams = {
  size: 56, seed: 11, maxHeight: 9, depth: 16, padRadius: 8, lake: true, treeDensity: 0.022,
}

export const ISLAND_MEDIUM: IslandParams = {
  size: 32, seed: 7, maxHeight: 6, depth: 11, padRadius: 5, lake: true, treeDensity: 0.022,
}

export interface IslandInfo {
  /** feet position on top of the build pad */
  spawn: { x: number; y: number; z: number }
  voxelCount: number
}

const colKey = (x: number, z: number): number => (x + 512) * 1024 + (z + 512)

/** 2-D fractal noise in roughly -1..1 (`n2` in islands.py). */
function makeN2(perlin: PerlinNoise) {
  return (x: number, z: number, seed: number, freq: number): number => {
    const vx = x * freq
    const vz = z * freq
    const vs = seed * 7.31
    return perlin.noise(vx, vz, vs) + 0.5 * perlin.noise(vx * 2.1 + 3.3, vz * 2.1 + 1.7, vs * 2.1)
  }
}

function addTree(world: World, x: number, y: number, z: number, rng: Rng): void {
  const height = rng.randint(4, 6)
  for (let dy = 0; dy < height; dy++) world.setBlock(x, y + dy, z, BLOCK.log)
  const top = y + height
  for (let dy = -2; dy < 2; dy++) {
    const r = dy < 0 ? 2 : 1
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && dy !== -1) continue
        world.setBlockIfAir(x + dx, top + dy, z + dz, BLOCK.leaves)
      }
    }
  }
  world.setBlock(x, top + 2, z, BLOCK.leaves)
}

export function generateIsland(world: World, p: IslandParams): IslandInfo {
  const { size, seed, maxHeight, depth, padRadius, lake, treeDensity } = p
  const rng = makeRng(seed)
  const n2 = makeN2(new PerlinNoise(seed))
  const R = size / 2
  const Ri = Math.trunc(R)

  // ---- heightmap + island mask
  const heights = new Map<number, { x: number; z: number; h: number; dep: number }>()
  for (let x = -Ri - 1; x <= Ri + 1; x++) {
    for (let z = -Ri - 1; z <= Ri + 1; z++) {
      const d = Math.hypot(x, z) / R
      const mask = 1 - d + 0.3 * n2(x, z, seed, 0.09)
      if (mask <= 0.12) continue
      let h = mask * maxHeight + 2 * n2(x, z, seed + 1, 0.16)
      h = mask > 0.5 ? Math.round(h / 2) * 2 : Math.round(h) // terraces inland
      h = Math.max(0, Math.min(maxHeight + 2, h))
      if (padRadius && Math.hypot(x, z) <= padRadius) h = 2
      let dep = Math.trunc(mask * depth + 2 * n2(x, z, seed + 2, 0.13) * mask)
      dep = Math.max(1, dep)
      heights.set(colKey(x, z), { x, z, h, dep })
    }
  }

  // ---- lake: pick a spot away from the pad
  const lakeCells = new Set<number>()
  let lakeLevel = 0
  if (lake) {
    const lr = Math.max(2, Math.trunc(size / 9))
    // islands.py samples a square and only keeps the lake *centre* off the pad, which
    // can leave the lake (radius + noise + sand shore) cutting into the pad. Sample a
    // ring instead so the whole lake always clears the pad.
    const minLakeDist = padRadius + lr + 3
    const maxLakeDist = Math.max(minLakeDist, R * 0.7)
    const angle = rng.random() * Math.PI * 2
    const dist = minLakeDist + rng.random() * (maxLakeDist - minLakeDist)
    const lx = Math.round(Math.cos(angle) * dist)
    const lz = Math.round(Math.sin(angle) * dist)
    for (const { x, z } of heights.values()) {
      if (Math.hypot(x - lx, z - lz) <= lr + 0.6 * n2(x, z, seed + 3, 0.3)) lakeCells.add(colKey(x, z))
    }
    if (lakeCells.size) {
      lakeLevel = Infinity
      for (const k of lakeCells) lakeLevel = Math.min(lakeLevel, heights.get(k)!.h)
    }
  }

  // ---- fill columns
  let voxelCount = 0
  for (const { x, z, h, dep } of heights.values()) {
    if (lakeCells.has(colKey(x, z))) {
      const floor = lakeLevel - 2
      for (let y = -dep; y < floor; y++) { world.setBlock(x, y, z, BLOCK.stone); voxelCount++ }
      world.setBlock(x, floor, z, BLOCK.sand)
      voxelCount++
      for (let y = floor + 1; y <= lakeLevel; y++) { world.setBlock(x, y, z, BLOCK.water); voxelCount++ }
      continue
    }
    let nearLake = false
    for (let dx = -1; dx <= 1 && !nearLake; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (lakeCells.has(colKey(x + dx, z + dz))) { nearLake = true; break }
      }
    }
    for (let y = -dep; y <= h; y++) {
      let kind: number
      if (y === h) {
        kind = nearLake && h <= lakeLevel + 1 ? BLOCK.sand : BLOCK.grass
      } else if (y >= h - 2) {
        kind = BLOCK.dirt
      } else {
        kind = BLOCK.stone
        const r = rng.random()
        if (r < 0.03) kind = BLOCK.ore_coal
        else if (r < 0.045) kind = BLOCK.ore_iron
      }
      world.setBlock(x, y, z, kind)
      voxelCount++
    }
    // snow on the highest peaks of big islands
    if (h >= maxHeight + 1 && size >= 40) world.setBlock(x, h, z, BLOCK.snow)
  }

  // ---- trees on grass, not on the pad
  const grassCells: { x: number; y: number; z: number }[] = []
  for (const { x, z, h } of heights.values()) {
    if (lakeCells.has(colKey(x, z))) continue
    if (world.getBlock(x, h, z) !== BLOCK.grass) continue
    const dist = Math.hypot(x, z)
    if (dist > padRadius + 1 && dist < R * 0.85) grassCells.push({ x, y: h, z })
  }
  const shuffled = rng.shuffle(grassCells)
  const placed: { x: number; z: number }[] = []
  const target = Math.trunc(grassCells.length * treeDensity)
  for (const { x, y, z } of shuffled) {
    if (placed.length >= target) break
    if (placed.every(p => Math.abs(x - p.x) > 3 || Math.abs(z - p.z) > 3)) {
      addTree(world, x, y + 1, z, rng)
      placed.push({ x, z })
    }
  }

  return { spawn: { x: 0.5, y: 3, z: 0.5 }, voxelCount }
}
