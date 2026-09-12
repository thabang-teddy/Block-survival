import { describe, expect, test } from 'vitest'
import { BLOCK } from '../../world/palette'
import { breakTime, dropForBlock, getItem, ITEMS } from '../registry'
import { Inventory, HOTBAR_SIZE, INVENTORY_SIZE } from '../inventory'

describe('registry', () => {
  test('every placeable block is an item that places itself', () => {
    expect(getItem('grass').block).toBe(BLOCK.grass)
    expect(getItem('ore_iron').block).toBe(BLOCK.ore_iron)
    expect(ITEMS.water).toBeUndefined()
    expect(ITEMS.air).toBeUndefined()
    expect(() => getItem('nope')).toThrow()
  })

  test('block drops: grass→dirt, ores→resources, water→nothing, others→themselves', () => {
    expect(dropForBlock(BLOCK.grass)).toBe('dirt')
    expect(dropForBlock(BLOCK.ore_coal)).toBe('coal')
    expect(dropForBlock(BLOCK.ore_iron)).toBe('iron')
    expect(dropForBlock(BLOCK.water)).toBeNull()
    expect(dropForBlock(BLOCK.stone)).toBe('stone')
    expect(dropForBlock(BLOCK.leaves)).toBe('leaves')
  })

  test('break times: pickaxe tiers speed digging; stone needs a pickaxe', () => {
    expect(breakTime(BLOCK.dirt, null)).toBeCloseTo(0.75)
    expect(breakTime(BLOCK.dirt, 'pickaxe_wood')).toBeCloseTo(0.5)
    expect(breakTime(BLOCK.stone, null)).toBe(Infinity)
    expect(breakTime(BLOCK.stone, 'sword')).toBe(Infinity)
    expect(breakTime(BLOCK.stone, 'pickaxe_wood')).toBeCloseTo(5 / 1.5)
    expect(breakTime(BLOCK.stone, 'pickaxe_iron')).toBeCloseTo(1.25)
    expect(breakTime(BLOCK.water, 'pickaxe_iron')).toBe(Infinity)
  })
})

describe('inventory', () => {
  test('stacks fill up to maxStack before opening a new slot', () => {
    const inv = new Inventory()
    expect(inv.add('dirt', 70)).toBe(0)
    expect(inv.get(0)).toEqual({ id: 'dirt', count: 64 })
    expect(inv.get(1)).toEqual({ id: 'dirt', count: 6 })
    expect(inv.count('dirt')).toBe(70)
    expect(inv.hotbar()).toHaveLength(HOTBAR_SIZE)
    expect(inv.all()).toHaveLength(INVENTORY_SIZE)
  })

  test('tools do not stack and a full inventory reports leftovers', () => {
    const inv = new Inventory()
    inv.add('sword', 1)
    inv.add('sword', 1)
    expect(inv.get(0)).toEqual({ id: 'sword', count: 1 })
    expect(inv.get(1)).toEqual({ id: 'sword', count: 1 })
    for (let i = 0; i < INVENTORY_SIZE - 2; i++) inv.add('rifle', 1)
    expect(inv.add('dirt', 5)).toBe(5)
  })

  test('takeFromSlot and remove update counts and clear empty slots', () => {
    const inv = new Inventory()
    inv.add('planks', 10)
    expect(inv.takeFromSlot(0, 3)).toBe(3)
    expect(inv.get(0)).toEqual({ id: 'planks', count: 7 })
    expect(inv.takeFromSlot(0, 99)).toBe(7)
    expect(inv.get(0)).toBeNull()
    expect(inv.takeFromSlot(0, 1)).toBe(0)

    inv.add('ammo', 100) // 100 in one slot (max 120)
    inv.add('ammo', 50)  // 20 top up + 30 new slot
    expect(inv.remove('ammo', 200)).toBe(false)
    expect(inv.count('ammo')).toBe(150)
    expect(inv.remove('ammo', 40)).toBe(true)
    expect(inv.count('ammo')).toBe(110)
  })

  test('version bumps only on real changes', () => {
    const inv = new Inventory()
    const v0 = inv.version
    inv.remove('dirt', 1)
    expect(inv.version).toBe(v0)
    inv.add('dirt', 1)
    expect(inv.version).toBe(v0 + 1)
    inv.swap(0, 5)
    expect(inv.get(5)).toEqual({ id: 'dirt', count: 1 })
    expect(inv.get(0)).toBeNull()
  })
})
