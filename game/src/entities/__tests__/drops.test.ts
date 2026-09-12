import { describe, expect, test } from 'vitest'
import { World } from '../../world/chunkStore'
import { BLOCK } from '../../world/palette'
import { Inventory } from '../../items/inventory'
import { canPickUp, DropManager } from '../drops'

function floorWorld(): World {
  const w = new World()
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) w.setBlock(x, 0, z, BLOCK.stone)
  return w
}

describe('drops', () => {
  test('a drop falls, settles on the floor and is picked up once the player is near', () => {
    const w = floorWorld()
    const dm = new DropManager(w)
    const inv = new Inventory()
    dm.spawn('dirt', 3, 0.5, 4, 0.5, 0, 0, 0)
    // far away: no pickup, it lands on the block top (y = 1)
    for (let i = 0; i < 120; i++) dm.update(1 / 60, 10, 1, 10, inv)
    expect(dm.drops).toHaveLength(1)
    expect(dm.drops[0].y).toBeCloseTo(1, 2)
    expect(inv.count('dirt')).toBe(0)
    // walk over it
    dm.update(1 / 60, 0.5, 1, 0.5, inv)
    expect(dm.drops).toHaveLength(0)
    expect(inv.count('dirt')).toBe(3)
    expect(dm.group.children).toHaveLength(0)
  })

  test('pickup waits for the spawn delay so thrown items are not caught instantly', () => {
    const dm = new DropManager(floorWorld())
    const inv = new Inventory()
    dm.spawn('planks', 1, 0.5, 1.2, 0.5)
    for (let i = 0; i < 20; i++) dm.update(1 / 60, 0.5, 1, 0.5, inv) // 0.33 s < delay
    expect(inv.count('planks')).toBe(0)
    for (let i = 0; i < 30; i++) dm.update(1 / 60, 0.5, 1, 0.5, inv)
    expect(inv.count('planks')).toBe(1)
  })

  test('a full inventory leaves the remainder on the ground', () => {
    const dm = new DropManager(floorWorld())
    const inv = new Inventory()
    for (let i = 0; i < 36; i++) inv.add('sword', 1)
    inv.takeFromSlot(0, 1)
    inv.add('dirt', 60)
    dm.spawn('dirt', 10, 0.5, 1.2, 0.5)
    for (let i = 0; i < 60; i++) dm.update(1 / 60, 0.5, 1, 0.5, inv)
    expect(inv.count('dirt')).toBe(64)
    expect(dm.drops[0].count).toBe(6)
  })

  test('pickup volume is a cylinder around the feet', () => {
    const base = { id: 1, item: 'dirt', count: 1, vx: 0, vy: 0, vz: 0, age: 1 }
    expect(canPickUp({ ...base, x: 1, y: 0, z: 0 }, 0, 0, 0)).toBe(true)
    expect(canPickUp({ ...base, x: 1.5, y: 0, z: 0 }, 0, 0, 0)).toBe(false)
    expect(canPickUp({ ...base, x: 0, y: -1, z: 0 }, 0, 0, 0)).toBe(true) // in a hole below
    expect(canPickUp({ ...base, x: 0, y: -2, z: 0 }, 0, 0, 0)).toBe(false)
    expect(canPickUp({ ...base, x: 0, y: 2.5, z: 0 }, 0, 0, 0)).toBe(false)
  })
})
