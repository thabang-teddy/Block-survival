import { describe, expect, test } from 'vitest'
import { Inventory } from '../inventory'
import { craft, craftStatus, getRecipe, RECIPES } from '../recipes'
import { getItem } from '../registry'

describe('recipes', () => {
  test('every recipe references known items', () => {
    for (const r of RECIPES) {
      expect(() => getItem(r.output.id)).not.toThrow()
      for (const i of r.inputs) expect(() => getItem(i.id)).not.toThrow()
    }
    expect(() => getRecipe('nope')).toThrow()
  })

  test('hand recipes work anywhere, bench recipes need a workbench', () => {
    const inv = new Inventory()
    inv.add('log', 1)
    expect(craftStatus(inv, getRecipe('planks'), false)).toBe('ok')
    inv.add('cobble', 3)
    inv.add('stick', 2)
    expect(craftStatus(inv, getRecipe('pickaxe_stone'), false)).toBe('needsBench')
    expect(craftStatus(inv, getRecipe('pickaxe_stone'), true)).toBe('ok')
    expect(craftStatus(inv, getRecipe('sword'), true)).toBe('missing')
  })

  test('crafting consumes inputs and adds the output', () => {
    const inv = new Inventory()
    inv.add('log', 2)
    expect(craft(inv, getRecipe('planks'), false)).toEqual({ overflow: 0 })
    expect(inv.count('log')).toBe(1)
    expect(inv.count('planks')).toBe(4)
    expect(craft(inv, getRecipe('rifle'), true)).toBeNull()
    expect(inv.count('planks')).toBe(4)
  })

  test('overflow is reported when the inventory is full', () => {
    const inv = new Inventory()
    for (let i = 0; i < 35; i++) inv.add('sword', 1)
    inv.add('log', 2) // slot 36 keeps one log after crafting, so no slot frees up
    expect(craft(inv, getRecipe('planks'), false)).toEqual({ overflow: 4 })
    expect(inv.count('planks')).toBe(0)
    expect(inv.count('log')).toBe(1)
  })

  test('bare hands to a rifle is reachable with the recipe graph', () => {
    // simulate gathering: logs, cobble, iron, coal, sand
    const inv = new Inventory()
    inv.add('log', 6)
    inv.add('cobble', 3)
    inv.add('iron', 14)
    inv.add('coal', 4)
    const bench = { near: false }
    const go = (id: string, times = 1) => {
      for (let i = 0; i < times; i++) expect(craft(inv, getRecipe(id), bench.near), id).not.toBeNull()
    }
    go('planks', 4)      // 16 planks
    go('stick', 2)       // 8 sticks, 12 planks
    go('workbench')      // 8 planks
    go('pickaxe_wood')   // 5 planks, 6 sticks
    bench.near = true
    go('pickaxe_stone')  // 4 sticks
    go('pickaxe_iron')   // iron 11, sticks 2
    go('sword')          // iron 9, sticks 1
    go('rifle')          // iron 1, planks 3, coal 2
    go('ammo')           // iron 0, coal 1
    expect(inv.count('rifle')).toBe(1)
    expect(inv.count('ammo')).toBe(30)
    expect(inv.count('pickaxe_iron')).toBe(1)
  })
})
