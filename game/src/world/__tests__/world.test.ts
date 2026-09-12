import { describe, expect, test } from 'vitest'
import { World, CHUNK, toChunkCoord, localIndex } from '../chunkStore'
import { AIR, BLOCK } from '../palette'
import { makeRng, PerlinNoise } from '../noise'
import { generateIsland, ISLAND_LARGE, ISLAND_MEDIUM } from '../islandGen'
import { faceVisible, meshChunk } from '../mesher'
import { raycastVoxels } from '../raycast'

describe('chunkStore', () => {
  test('negative coordinates map to the correct chunk and local index', () => {
    // Arrange / Act
    const c = toChunkCoord(-1, -17, 15)
    // Assert
    expect(c).toEqual({ cx: -1, cy: -2, cz: 0 })
    expect(localIndex(-1, -17, 15)).toBe((15 << 8) | (15 << 4) | 15)
  })

  test('setBlock round-trips and marks the chunk and border neighbours dirty', () => {
    const w = new World()
    w.setBlock(16, 0, 0, BLOCK.stone) // x = 16 is local 0 of chunk 1 → neighbour chunk 0 must exist to be dirtied
    w.takeDirty()
    w.setBlock(15, 0, 0, BLOCK.dirt)  // local 15 of chunk 0 → borders chunk 1
    expect(w.getBlock(16, 0, 0)).toBe(BLOCK.stone)
    expect(w.getBlock(15, 0, 0)).toBe(BLOCK.dirt)
    expect(w.getBlock(99, 99, 99)).toBe(AIR)
    expect(w.takeDirty().sort()).toEqual(['0,0,0', '1,0,0'])
    expect(w.takeDirty()).toEqual([])
  })

  test('setting air in an unallocated chunk allocates nothing', () => {
    const w = new World()
    w.setBlock(5, 5, 5, AIR)
    expect(w.chunkCount).toBe(0)
  })
})

describe('noise', () => {
  test('rng and perlin are deterministic per seed and differ across seeds', () => {
    const a = makeRng(7)
    const b = makeRng(7)
    const c = makeRng(8)
    const seqA = [a.random(), a.random(), a.randint(1, 6)]
    expect(seqA).toEqual([b.random(), b.random(), b.randint(1, 6)])
    expect(seqA[0]).not.toBe(c.random())

    const n1 = new PerlinNoise(3)
    const n2 = new PerlinNoise(3)
    expect(n1.noise(1.3, 2.7, 0.2)).toBe(n2.noise(1.3, 2.7, 0.2))
    expect(n1.noise(1.3, 2.7, 0.2)).not.toBe(new PerlinNoise(4).noise(1.3, 2.7, 0.2))
  })

  test('perlin stays within -1..1 and is 0 on integer lattice points', () => {
    const n = new PerlinNoise(1)
    expect(n.noise(3, 4, 5)).toBe(0)
    for (let i = 0; i < 500; i++) {
      const v = n.noise(i * 0.137, i * 0.311, i * 0.071)
      expect(Math.abs(v)).toBeLessThanOrEqual(1)
    }
  })

  test('randint is inclusive on both ends and shuffle keeps elements', () => {
    const r = makeRng(42)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) seen.add(r.randint(4, 6))
    expect([...seen].sort()).toEqual([4, 5, 6])
    expect(r.shuffle([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4])
  })
})

describe('islandGen', () => {
  test('Island_Large has a flat grass build pad at y=2 with spawn on top', () => {
    const w = new World()
    const info = generateIsland(w, ISLAND_LARGE)
    expect(info.voxelCount).toBeGreaterThan(10_000)
    // every column inside the pad radius is grass at y=2 with air above
    for (let x = -8; x <= 8; x++) {
      for (let z = -8; z <= 8; z++) {
        if (Math.hypot(x, z) > ISLAND_LARGE.padRadius) continue
        expect(w.getBlock(x, 2, z), `pad column ${x},${z}`).toBe(BLOCK.grass)
        expect(w.getBlock(x, 3, z)).toBe(AIR)
      }
    }
    expect(info.spawn).toEqual({ x: 0.5, y: 3, z: 0.5 })
  })

  test('is deterministic for a seed and contains water, ore and trees', () => {
    const a = new World()
    const b = new World()
    generateIsland(a, ISLAND_MEDIUM)
    generateIsland(b, ISLAND_MEDIUM)
    const counts = new Map<number, number>()
    const bnd = a.bounds
    for (let x = bnd.minX; x <= bnd.maxX; x++) {
      for (let y = bnd.minY; y <= bnd.maxY; y++) {
        for (let z = bnd.minZ; z <= bnd.maxZ; z++) {
          const id = a.getBlock(x, y, z)
          expect(id).toBe(b.getBlock(x, y, z))
          counts.set(id, (counts.get(id) ?? 0) + 1)
        }
      }
    }
    expect(counts.get(BLOCK.water)).toBeGreaterThan(0)
    expect(counts.get(BLOCK.ore_coal)).toBeGreaterThan(0)
    expect(counts.get(BLOCK.log)).toBeGreaterThan(0)
    expect(counts.get(BLOCK.leaves)).toBeGreaterThan(0)
    expect(bnd.minY).toBeLessThan(-5) // hangs below y=0
  })
})

describe('mesher', () => {
  test('faceVisible follows the add_voxels rule', () => {
    expect(faceVisible(BLOCK.stone, AIR, false)).toBe(true)
    expect(faceVisible(BLOCK.stone, BLOCK.dirt, false)).toBe(false)
    expect(faceVisible(BLOCK.stone, BLOCK.glass, false)).toBe(true) // see-through neighbour of a different kind
    expect(faceVisible(BLOCK.glass, BLOCK.glass, false)).toBe(false) // same kind → merged
    expect(faceVisible(BLOCK.water, BLOCK.glass, false)).toBe(false) // water sides only against air
    expect(faceVisible(BLOCK.water, BLOCK.glass, true)).toBe(true)
  })

  test('a lone block emits 6 quads; two touching blocks emit 10', () => {
    const w = new World()
    w.setBlock(1, 1, 1, BLOCK.stone)
    const one = meshChunk(w, 0, 0, 0).opaque!
    expect(one.indices.length).toBe(6 * 6)
    expect(one.positions.length).toBe(6 * 4 * 3)
    w.setBlock(2, 1, 1, BLOCK.stone)
    const two = meshChunk(w, 0, 0, 0).opaque!
    expect(two.indices.length).toBe(10 * 6)
  })

  test('translucent blocks go to the translucent geometry with their alpha', () => {
    const w = new World()
    w.setBlock(0, 0, 0, BLOCK.water)
    const m = meshChunk(w, 0, 0, 0)
    expect(m.opaque).toBeNull()
    expect(m.translucent!.colors[3]).toBeCloseTo(0.75)
    // the top face (emitted first) is dropped by 0.15; side faces keep full height
    const pos = m.translucent!.positions
    for (let v = 0; v < 4; v++) expect(pos[v * 3 + 1]).toBeCloseTo(0.85)
    expect(Math.max(...Array.from(pos).filter((_, i) => i % 3 === 1))).toBe(1)
  })

  test('grass uses the green top colour and brown sides', () => {
    const w = new World()
    w.setBlock(0, 0, 0, BLOCK.grass)
    const m = meshChunk(w, 0, 0, 0).opaque!
    // first face emitted is +Y (top); all four verts have full AO so colour is unshaded
    expect(m.normals.slice(0, 3)).toEqual(new Float32Array([0, 1, 0]))
    expect(m.colors[1]).toBeCloseTo(0.66)
    expect(m.colors[0]).toBeCloseTo(0.4)
  })

  test('empty chunk key yields no geometry', () => {
    expect(meshChunk(new World(), 5, 5, 5)).toEqual({ opaque: null, translucent: null })
  })

  test('chunk size constant matches the bit layout', () => {
    expect(CHUNK).toBe(16)
  })
})

describe('raycast', () => {
  test('hits the first solid block and reports the entered face normal', () => {
    const w = new World()
    w.setBlock(0, 0, 5, BLOCK.stone)
    const hit = raycastVoxels(w, 0.5, 0.5, 0.5, 0, 0, 1, 10)!
    expect(hit).toMatchObject({ x: 0, y: 0, z: 5, nx: 0, ny: 0, nz: -1, block: BLOCK.stone })
    expect(hit.distance).toBeCloseTo(4.5)
  })

  test('returns null beyond max distance and skips water by default', () => {
    const w = new World()
    w.setBlock(0, 0, 8, BLOCK.stone)
    w.setBlock(0, 0, 3, BLOCK.water)
    expect(raycastVoxels(w, 0.5, 0.5, 0.5, 0, 0, 1, 5)).toBeNull()
    expect(raycastVoxels(w, 0.5, 0.5, 0.5, 0, 0, 1, 10)!.z).toBe(8)
    expect(raycastVoxels(w, 0.5, 0.5, 0.5, 0, 0, 1, 10, false)!.z).toBe(3)
  })

  test('diagonal rays step through the correct cells', () => {
    const w = new World()
    w.setBlock(3, 0, 3, BLOCK.stone)
    const hit = raycastVoxels(w, 0.5, 0.5, 0.5, 1, 0, 1, 10)!
    expect([hit.x, hit.z]).toEqual([3, 3])
    expect(Math.abs(hit.nx) + Math.abs(hit.nz)).toBe(1)
  })
})
