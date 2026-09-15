import { describe, expect, test } from 'vitest'
import { CHUNK, World, localIndex } from '../chunkStore'
import { AIR, BLOCK, isSolid } from '../palette'
import { generateIsland, ISLAND_LARGE } from '../islandGen'
import { generateChunk, groundSpawn, TerrainGenerator, WORLD_CHUNKS_Y, WORLD_HEIGHT } from '../terrainGen'
import { GROUND_MAX, GROUND_MIN, PAD_RADIUS, SEA_LEVEL, TREE_MAX_HEIGHT } from '../groundGen'
import { ISLAND_CELL, islandAtCell, islandsNear, LEGACY_ISLAND_Y } from '../islandField'
import { IslandTemplate } from '../islandTemplate'

/** every block of a column of chunks, as a World for easy lookups */
function fillColumn(w: World, seed: number, cx: number, cz: number): void {
  for (let cy = 0; cy < WORLD_CHUNKS_Y; cy++) {
    const data = generateChunk(seed, cx, cy, cz)
    if (!data) continue
    for (let i = 0; i < data.length; i++) {
      if (!data[i]) continue
      const lx = i >> 8
      const ly = (i >> 4) & 15
      const lz = i & 15
      w.setBlock(cx * CHUNK + lx, cy * CHUNK + ly, cz * CHUNK + lz, data[i])
    }
  }
}

function topOf(w: World, x: number, z: number, below = WORLD_HEIGHT): number {
  for (let y = below - 1; y >= 0; y--) if (w.getBlock(x, y, z) !== AIR) return y
  return -1
}

describe('generateChunk', () => {
  test('is deterministic per seed and differs across seeds', () => {
    const a = generateChunk(11, 3, 2, -4)!
    const b = generateChunk(11, 3, 2, -4)!
    expect(a).toEqual(b)
    expect(generateChunk(12, 3, 2, -4)).not.toEqual(a)
  })

  test('is independent of the order chunks are requested in', () => {
    const forward = new TerrainGenerator(5)
    const backward = new TerrainGenerator(5)
    const coords: [number, number, number][] = []
    for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) for (let cy = 0; cy < WORLD_CHUNKS_Y; cy++) coords.push([cx, cy, cz])
    const f = coords.map(([cx, cy, cz]) => forward.generateChunk(cx, cy, cz))
    const b = coords.slice().reverse().map(([cx, cy, cz]) => backward.generateChunk(cx, cy, cz)).reverse()
    expect(f).toEqual(b)
  })

  test('returns null for all-air sky chunks and outside the vertical band', () => {
    expect(generateChunk(11, 40, WORLD_CHUNKS_Y - 1, 40)).toBeNull()
    expect(generateChunk(11, 0, -1, 0)).toBeNull()
    expect(generateChunk(11, 0, WORLD_CHUNKS_Y, 0)).toBeNull()
    expect(generateChunk(11, 0, 0, 0)).not.toBeNull()
  })

  test('legacy island: cell (0,0) equals Island_Large lifted to y = 80', () => {
    const old = new World()
    generateIsland(old, ISLAND_LARGE)
    const fresh = new World()
    for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) fillColumn(fresh, 11, cx, cz)
    let compared = 0
    for (let x = -30; x <= 30; x++) {
      for (let z = -30; z <= 30; z++) {
        for (let y = -20; y <= 25; y++) {
          const id = old.getBlock(x, y, z)
          if (id === AIR) continue
          expect(fresh.getBlock(x, y + LEGACY_ISLAND_Y, z), `${x},${y},${z}`).toBe(id)
          compared++
        }
      }
    }
    expect(compared).toBeGreaterThan(10_000)
    // and it floats clear of the ground
    const template = new IslandTemplate(ISLAND_LARGE)
    expect(template.minY + LEGACY_ISLAND_Y).toBeGreaterThanOrEqual(GROUND_MAX + TREE_MAX_HEIGHT + 3)
  })

  test('ground invariants hold over a 6×6 chunk sample', () => {
    const w = new World()
    const seed = 21
    for (let cx = -3; cx < 3; cx++) for (let cz = -3; cz < 3; cz++) fillColumn(w, seed, cx, cz)
    let water = 0
    let grass = 0
    for (let x = -48; x < 48; x++) {
      for (let z = -48; z < 48; z++) {
        expect(w.getBlock(x, 0, z)).toBe(BLOCK.bedrock)
        // solid ground column with no air pockets up to its surface
        let y = 1
        while (isSolid(w.getBlock(x, y, z)) && w.getBlock(x, y, z) !== BLOCK.log && w.getBlock(x, y, z) !== BLOCK.leaves) y++
        const h = y - 1
        expect(h).toBeGreaterThanOrEqual(GROUND_MIN)
        expect(h).toBeLessThanOrEqual(GROUND_MAX)
        const surface = w.getBlock(x, h, z)
        if (surface === BLOCK.grass) grass++
        if (h < SEA_LEVEL) {
          expect(surface).toBe(BLOCK.sand)
          for (let wy = h + 1; wy <= SEA_LEVEL; wy++) expect(w.getBlock(x, wy, z)).toBe(BLOCK.water)
          water++
        }
        expect(w.getBlock(x, SEA_LEVEL + 1, z)).not.toBe(BLOCK.water)
      }
    }
    expect(grass).toBeGreaterThan(0)
    expect(water).toBeGreaterThan(0)
  })

  test('spawn pad: flat, dry grass with headroom, for many seeds', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const w = new World()
      for (let cx = -1; cx <= 0; cx++) for (let cz = -1; cz <= 0; cz++) fillColumn(w, seed, cx, cz)
      const spawn = groundSpawn(seed)
      expect(spawn).toEqual({ x: 0.5, y: expect.any(Number), z: 0.5 })
      const padY = spawn.y - 1
      expect(padY).toBeGreaterThanOrEqual(SEA_LEVEL + 2)
      expect(w.getBlock(0, padY, 0)).toBe(BLOCK.grass)
      expect(w.getBlock(0, padY + 1, 0)).toBe(AIR)
      expect(w.getBlock(0, padY + 2, 0)).toBe(AIR)
      for (let x = -PAD_RADIUS; x <= PAD_RADIUS; x++) {
        for (let z = -PAD_RADIUS; z <= PAD_RADIUS; z++) {
          if (Math.hypot(x, z) > PAD_RADIUS) continue
          // (the legacy island floats above the pad: look under it)
          expect(topOf(w, x, z, LEGACY_ISLAND_Y - 20), `seed ${seed} pad ${x},${z}`).toBe(padY)
          expect(w.getBlock(x, padY, z)).toBe(BLOCK.grass)
        }
      }
      for (let x = -12; x <= 12; x++) {
        for (let z = -12; z <= 12; z++) {
          for (let y = 0; y <= SEA_LEVEL; y++) expect(w.getBlock(x, y, z), `seed ${seed} water at ${x},${y},${z}`).not.toBe(BLOCK.water)
        }
      }
    }
  })

  test('trees straddling a chunk border are the same from both chunks', () => {
    // every ground tree in an 8×8 chunk area must be complete, including the ones whose
    // canopy crosses into a neighbouring chunk (each chunk stamps its share independently)
    const seed = 33
    const w = new World()
    for (let cx = -4; cx < 4; cx++) for (let cz = -4; cz < 4; cz++) fillColumn(w, seed, cx, cz)
    let borderCanopy = 0
    let trees = 0
    for (let x = -61; x < 61; x++) {
      for (let z = -61; z < 61; z++) {
        // a ground trunk: logs standing on grass (islands are far above GROUND_MAX)
        let base = -1
        for (let y = GROUND_MIN; y <= GROUND_MAX + 1; y++) {
          if (w.getBlock(x, y, z) === BLOCK.log && w.getBlock(x, y - 1, z) === BLOCK.grass) { base = y; break }
        }
        if (base < 0) continue
        trees++
        let lastLog = base
        while (w.getBlock(x, lastLog + 1, z) === BLOCK.log) lastLog++
        expect(lastLog - base + 1).toBeGreaterThanOrEqual(4)
        // the two wide canopy layers (last log and the one below) are complete: leaves, or another tree's trunk
        for (const y of [lastLog - 1, lastLog]) {
          for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
              if (!dx && !dz) continue
              if (y === lastLog - 1 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue // addTree leaves those corners out
              expect([BLOCK.leaves, BLOCK.log], `canopy of ${x},${z}`).toContain(w.getBlock(x + dx, y, z + dz))
            }
          }
        }
        expect(w.getBlock(x, lastLog + 3, z)).toBe(BLOCK.leaves)
        if (((x & 15) <= 1 || (x & 15) >= 14) || ((z & 15) <= 1 || (z & 15) >= 14)) borderCanopy++
      }
    }
    expect(trees).toBeGreaterThan(20)
    expect(borderCanopy).toBeGreaterThan(0)
  })

  test('floating islands stay in their cell, above the ground and never overlap', () => {
    const seed = 8
    let count = 0
    for (let ix = -6; ix <= 6; ix++) {
      for (let iz = -6; iz <= 6; iz++) {
        const island = islandAtCell(seed, ix, iz)
        if (!island) continue
        count++
        const t = new IslandTemplate(island.params)
        if (ix || iz) {
          expect(island.x + t.minX).toBeGreaterThanOrEqual(ix * ISLAND_CELL)
          expect(island.x + t.maxX).toBeLessThan((ix + 1) * ISLAND_CELL)
          expect(island.z + t.minZ).toBeGreaterThanOrEqual(iz * ISLAND_CELL)
          expect(island.z + t.maxZ).toBeLessThan((iz + 1) * ISLAND_CELL)
        }
        expect(island.baseY + t.minY).toBeGreaterThanOrEqual(56)
        expect(island.baseY + t.maxY).toBeLessThan(WORLD_HEIGHT)
      }
    }
    expect(count).toBeGreaterThan(40)
    expect(islandAtCell(seed, 0, 0)).toMatchObject({ x: 0, z: 0, baseY: LEGACY_ISLAND_Y, params: ISLAND_LARGE })
    expect(islandsNear(seed, 0, 0, 15, 15).map(i => `${i.ix},${i.iz}`)).toContain('0,0')
  })

  test('a generated island is actually stamped into the sky chunks', () => {
    const seed = 8
    const island = [...Array(50).keys()].map(i => islandAtCell(seed, i + 1, 2)).find(Boolean)!
    const w = new World()
    const cx = island.x >> 4
    const cz = island.z >> 4
    fillColumn(w, seed, cx, cz)
    const top = topOf(w, island.x, island.z)
    expect(top).toBeGreaterThanOrEqual(island.baseY)
    expect([BLOCK.grass, BLOCK.sand, BLOCK.water, BLOCK.log, BLOCK.leaves, BLOCK.snow]).toContain(w.getBlock(island.x, top, island.z))
  })

  test('chunk data uses localIndex layout', () => {
    const data = generateChunk(11, 0, 0, 0)!
    expect(data[localIndex(3, 0, 5)]).toBe(BLOCK.bedrock)
    expect(data[localIndex(3, 1, 5)]).toBe(BLOCK.stone)
  })
})
