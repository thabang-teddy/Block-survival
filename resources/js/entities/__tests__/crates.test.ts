import { describe, expect, test } from 'vitest'
import { World } from '../../world/chunkStore'
import { BLOCK } from '../../world/palette'
import { Inventory } from '../../items/inventory'
import { CrateManager, settle } from '../crates'
import { computeScore, formatTime, nightsSurvived, timeAgo } from '../../game/score'

function floor(): World {
  const w = new World()
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) w.setBlock(x, 0, z, BLOCK.stone)
  return w
}

describe('loot crates', () => {
  test('settle drops the crate onto the ground below the death point', () => {
    const w = floor()
    expect(settle(w, 2.3, 6.7, -1.2)).toEqual({ x: 2.5, y: 1, z: -1.5 })
    expect(settle(w, 2.3, 1.2, -1.2)).toEqual({ x: 2.5, y: 1, z: -1.5 })
    expect(settle(w, 40, 5, 40)).toEqual({ x: 40, y: 5, z: 40 }) // nothing below: stays put
  })

  test('dropInventory empties the inventory into a crate; nothing for an empty inventory', () => {
    const cm = new CrateManager(floor())
    const inv = new Inventory()
    expect(cm.dropInventory(inv, 0.5, 3, 0.5)).toBeNull()
    inv.add('planks', 10)
    inv.add('rifle', 1)
    const crate = cm.dropInventory(inv, 0.5, 3, 0.5)!
    expect(crate.items).toEqual([{ id: 'planks', count: 10 }, { id: 'rifle', count: 1 }])
    expect(inv.count('planks')).toBe(0)
    expect(inv.count('rifle')).toBe(0)
    expect(crate.y).toBe(1)
    expect(cm.group.children).toHaveLength(1)
  })

  test('targeted picks the crate in front of the player within reach', () => {
    const cm = new CrateManager(floor())
    const inv = new Inventory()
    inv.add('dirt', 1)
    const crate = cm.dropInventory(inv, 2.5, 1, 0.5)!
    // looking +X from the origin at eye height
    expect(cm.targeted(0.5, 2.6, 0.5, 1, -0.3, 0)).toBe(crate)
    // looking away
    expect(cm.targeted(0.5, 2.6, 0.5, -1, 0, 0)).toBeNull()
    // too far
    expect(cm.targeted(-3, 2.6, 0.5, 1, 0, 0)).toBeNull()
  })

  test('loot takes what fits and removes the crate when empty', () => {
    const cm = new CrateManager(floor())
    const src = new Inventory()
    src.add('planks', 100)
    const crate = cm.dropInventory(src, 0.5, 1, 0.5)!
    const inv = new Inventory()
    for (let i = 0; i < 35; i++) inv.add('sword', 1) // one free slot → 64 planks fit
    expect(cm.loot(crate, inv)).toBe(64)
    expect(crate.items).toEqual([{ id: 'planks', count: 36 }])
    expect(cm.crates).toHaveLength(1)
    inv.takeFromSlot(0, 1)
    expect(cm.loot(crate, inv)).toBe(36)
    expect(cm.crates).toHaveLength(0)
    expect(cm.group.children).toHaveLength(0)
  })
})

describe('score', () => {
  test('nights × 100 + kills × 5, counting only completed nights', () => {
    expect(computeScore(0, 0)).toBe(0)
    expect(computeScore(2, 13)).toBe(265)
    expect(nightsSurvived(0, 'day')).toBe(0)
    expect(nightsSurvived(1, 'night')).toBe(0)
    expect(nightsSurvived(1, 'day')).toBe(1)
    expect(nightsSurvived(3, 'night')).toBe(2)
  })

  test('formatTime', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(75.9)).toBe('1:15')
    expect(formatTime(3725)).toBe('1h 2m')
  })
})

describe('timeAgo', () => {
  const now = Date.parse('2026-09-14T12:00:00Z')
  test('rounds down to the coarsest sensible unit', () => {
    expect(timeAgo('2026-09-14T11:59:40Z', now)).toBe('just now')
    expect(timeAgo('2026-09-14T11:57:00Z', now)).toBe('3 min ago')
    expect(timeAgo('2026-09-14T09:30:00Z', now)).toBe('2 h ago')
    expect(timeAgo('2026-09-10T12:00:00Z', now)).toBe('4 d ago')
    expect(timeAgo('nope', now)).toBe('a while ago')
  })
})
