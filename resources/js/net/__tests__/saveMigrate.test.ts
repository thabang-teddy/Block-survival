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

describe('migrateSave', () => {
  test('lifts v1 edits (and prop metadata) onto the legacy island and moves the spawn to the ground pad', () => {
    const out = migrateSave(v1)!
    expect(out.version).toBe(2)
    expect(out.seed).toBe(ISLAND_LARGE.seed)
    expect(out.edits[0]).toEqual({ x: 1, y: 7 + LEGACY_ISLAND_Y, z: 2, id: BLOCK.planks })
    expect(out.edits[1].meta).toMatchObject({ y: 7 + LEGACY_ISLAND_Y, partner: { x: 3, y: 7 + LEGACY_ISLAND_Y, z: 3 } })
    expect(out.spawn).toEqual(groundSpawn(ISLAND_LARGE.seed))
    expect(out.spawn.y).toBeLessThan(LEGACY_ISLAND_Y)
    expect(out).toMatchObject({ time: 123, kills: 4, deaths: 1, inventory: [null] })
    expect(v1.edits[0].y).toBe(7) // input untouched
  })

  test('passes v2 through and rejects anything else', () => {
    const v2 = { ...v1, version: 2, seed: 99 }
    expect(migrateSave(v2)).toBe(v2)
    expect(migrateSave({ ...v1, version: 3 })).toBeNull()
    expect(migrateSave({ version: 2, seed: 1 })).toBeNull()
    expect(migrateSave('nope')).toBeNull()
  })
})
