import { describe, expect, test } from 'vitest'
import { islandAtCell, islandsNear, IslandTemplates } from '../islandField'
import { PAD_BLEND, PAD_RADIUS } from '../groundGen'
import { AIR } from '../palette'
import { TerrainGenerator } from '../terrainGen'
import { UPDRAFT, updraftAt, updraftFor, type Updraft } from '../updraft'

const templates = new IslandTemplates()
const flatGround = (): number => 40

function shaftFor(seed: number, ix: number, iz: number): { u: Updraft; island: NonNullable<ReturnType<typeof islandAtCell>> } {
  const island = islandAtCell(seed, ix, iz)!
  return { u: updraftFor(island, templates.get(island), flatGround), island }
}

/** every island in a few cells around the origin, for several seeds */
function sampleIslands(seeds: number[]): { seed: number; ix: number; iz: number }[] {
  const out: { seed: number; ix: number; iz: number }[] = []
  for (const seed of seeds) {
    for (let ix = -2; ix <= 2; ix++) for (let iz = -2; iz <= 2; iz++) if (islandAtCell(seed, ix, iz)) out.push({ seed, ix, iz })
  }
  return out
}

describe('updraftFor', () => {
  test('is deterministic for (seed, island)', () => {
    const a = shaftFor(11, 0, 0).u
    const b = shaftFor(11, 0, 0).u
    expect(a).toEqual(b)
    expect(shaftFor(7, 1, 1).u).not.toEqual(shaftFor(7, 1, -1).u)
  })

  test('the axis is clear of the island with a gap of air on every side', () => {
    for (const { seed, ix, iz } of sampleIslands([11, 3, 77])) {
      const { u, island } = shaftFor(seed, ix, iz)
      const t = templates.get(island)
      const ax = Math.floor(u.x) - island.x
      const az = Math.floor(u.z) - island.z
      // the axis column and its neighbours within the gap hold no island block at all
      for (let dx = -UPDRAFT.gap + 1; dx <= UPDRAFT.gap - 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let y = t.minY; y <= t.maxY; y++) {
            expect(t.get(ax + dx, y, az + dz), `seed ${seed} island ${ix},${iz} block ${dx},${y},${dz}`).toBe(AIR)
          }
        }
      }
      // but the island is close: some block within a few blocks of the axis
      let near = false
      const reach = UPDRAFT.gap + 3
      for (let sx = -reach; sx <= reach && !near; sx++) {
        for (let sz = -reach; sz <= reach && !near; sz++) {
          for (let y = t.minY; y <= t.maxY; y++) if (t.get(ax + sx, y, az + sz) !== AIR) { near = true; break }
        }
      }
      expect(near, `seed ${seed} island ${ix},${iz} shaft is not beside the island`).toBe(true)
    }
  })

  test('bottom is on the ground and the top is just above the rim', () => {
    for (const { seed, ix, iz } of sampleIslands([11, 3])) {
      const { u, island } = shaftFor(seed, ix, iz)
      const t = templates.get(island)
      expect(u.bottomY).toBe(flatGround() + 1)
      expect(u.topY).toBeGreaterThan(island.baseY + UPDRAFT.aboveRim - 1)
      expect(u.topY).toBeLessThanOrEqual(island.baseY + t.maxY + UPDRAFT.aboveRim)
      expect(u.radius).toBe(UPDRAFT.radius)
    }
  })

  test('the legacy island shaft is ~30 m east of the pad and clear of it, for many seeds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const u = shaftFor(seed, 0, 0).u
      expect(u.z).toBe(0.5)
      expect(u.x).toBeGreaterThanOrEqual(25)
      expect(u.x).toBeLessThanOrEqual(36)
      expect(Math.hypot(u.x, u.z)).toBeGreaterThan(PAD_RADIUS + PAD_BLEND + UPDRAFT.radius)
    }
  })
})

describe('TerrainGenerator.updraftsNear', () => {
  test('finds every shaft in a range regardless of how the range is cut', () => {
    const g = new TerrainGenerator(11)
    const whole = g.updraftsNear(-200, -200, 200, 200)
    expect(whole.length).toBe(islandsNear(11, -240, -240, 240, 240).filter(i => {
      const u = g.updraftOf(i)
      return u.x >= -200 && u.x <= 201 && u.z >= -200 && u.z <= 201
    }).length)
    expect(whole.length).toBeGreaterThan(3)
    const halves = [...g.updraftsNear(-200, -200, -1, 200), ...g.updraftsNear(0, -200, 200, 200)]
    const key = (u: Updraft): string => `${u.ix},${u.iz}`
    expect(halves.map(key).sort()).toEqual(whole.map(key).sort())
  })

  test('the ground under the shaft is the real ground height', () => {
    const g = new TerrainGenerator(11)
    const u = g.updraftOf(islandAtCell(11, 0, 0)!)
    expect(u.bottomY).toBe(g.ground.height(Math.floor(u.x), Math.floor(u.z)) + 1)
  })
})

describe('updraftAt', () => {
  const shaft: Updraft = { x: 10.5, z: 10.5, bottomY: 41, topY: 90, radius: 1.25, ix: 0, iz: 0 }
  test('inside the radius and height band', () => {
    expect(updraftAt([shaft], 10.5, 60, 10.5)).toBe(shaft)
    expect(updraftAt([shaft], 11.7, 41, 10.5)).toBe(shaft)
  })
  test('outside', () => {
    expect(updraftAt([shaft], 12, 60, 10.5)).toBeNull()
    expect(updraftAt([shaft], 10.5, 40.9, 10.5)).toBeNull()
    expect(updraftAt([shaft], 10.5, 90.1, 10.5)).toBeNull()
    expect(updraftAt([], 10.5, 60, 10.5)).toBeNull()
  })
})
