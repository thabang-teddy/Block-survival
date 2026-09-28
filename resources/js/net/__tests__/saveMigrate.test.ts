import { describe, expect, test } from 'vitest'
import { migrateSave } from '../saveMigrate'
import { BLOCK } from '../../world/palette'
import { LEGACY_ISLAND_Y } from '../../world/islandField'
import { groundSpawn } from '../../world/terrainGen'
import { ISLAND_LARGE } from '../../world/islandGen'

const v1 = {
  version: 1,
  seed: 11,
  time: 123,
  edits: [
    { x: 1, y: 7, z: 2, id: BLOCK.planks },
    { x: 3, y: 7, z: 2, id: BLOCK.bed, meta: { id: BLOCK.bed, x: 3, y: 7, z: 2, yaw: 0, primary: true, partner: { x: 3, y: 7, z: 3 } } },
  ],
  inventory: [null],
  spawn: { x: 0.5, y: 7, z: 0.5 },
  kills: 4,
  deaths: 1,
}

const v2 = { ...v1, version: 2, seed: 99, spawn: { x: 5, y: 40, z: 5 } }

describe('migrateSave', () => {
  test('lifts v1 edits (and prop metadata) onto the legacy island and moves the spawn to the ground pad', () => {
    const out = migrateSave(v1, 7)!
    expect(out.version).toBe(3)
    expect(out.seed).toBe(ISLAND_LARGE.seed)
    expect(out.edits[0]).toEqual({ x: 1, y: 7 + LEGACY_ISLAND_Y, z: 2, id: BLOCK.planks })
    expect(out.edits[1].meta).toMatchObject({ y: 7 + LEGACY_ISLAND_Y, partner: { x: 3, y: 7 + LEGACY_ISLAND_Y, z: 3 } })
    const host = out.players['7']
    expect(host.spawn).toEqual(groundSpawn(ISLAND_LARGE.seed))
    expect(host.spawn.y).toBeLessThan(LEGACY_ISLAND_Y)
    expect(host).toMatchObject({ kills: 4, deaths: 1, inventory: [null] })
    expect(out.time).toBe(123)
    expect(v1.edits[0].y).toBe(7) // input untouched
  })

  test('puts a v2 world\'s host under players with empty live state', () => {
    const out = migrateSave(v2, 42)!
    expect(out).toMatchObject({ version: 3, seed: 99, time: 123, zombies: [], drops: [], crates: [], savedAt: 0 })
    expect(out.edits).toBe(v2.edits)
    expect(Object.keys(out.players)).toEqual(['42'])
    expect(out.players['42']).toEqual({
      name: 'Player',
      inventory: [null],
      spawn: { x: 5, y: 40, z: 5 },
      pos: { x: 5, y: 40, z: 5, yaw: 0, pitch: 0 },
      health: 100,
      magazine: 0,
      kills: 4,
      deaths: 1,
    })
  })

  test('passes v3 through and rejects anything else', () => {
    const v3 = { version: 3, seed: 1, time: 0, edits: [], players: {}, zombies: [], drops: [], crates: [], savedAt: 1 }
    expect(migrateSave(v3, 1)).toBe(v3)
    expect(migrateSave({ ...v3, players: undefined }, 1)).toBeNull()
    expect(migrateSave({ ...v1, version: 4 }, 1)).toBeNull()
    expect(migrateSave({ version: 2, seed: 1 }, 1)).toBeNull()
    expect(migrateSave({ version: 2, edits: [] }, 1)).toBeNull()
    expect(migrateSave('nope', 1)).toBeNull()
  })
})
