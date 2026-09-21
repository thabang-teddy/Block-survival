/**
 * The mineral half of the item registry (issue #25): every ore drops something you can
 * use, the pickaxe ladder gates the deep ores, and gold is the odd one out — fast to
 * dig with but too soft for anything iron opens.
 */
import { describe, expect, test } from 'vitest'
import { BLOCK } from '../../world/palette'
import { ORES } from '../../world/ores'
import { breakTime, dropForBlock, getItem, ITEMS, mineTierOf } from '../registry'
import { craft, craftStatus, getRecipe, RECIPES } from '../recipes'
import { Inventory } from '../inventory'

const PICKAXES = ['pickaxe_wood', 'pickaxe_stone', 'pickaxe_copper', 'pickaxe_iron', 'pickaxe_gold', 'pickaxe_diamond']

describe('minerals in the registry', () => {
  test('every ore drops an item that exists', () => {
    for (const o of ORES) {
      expect(dropForBlock(o.block)).toBe(o.drop)
      expect(() => getItem(o.drop)).not.toThrow()
      expect(getItem(o.drop).kind).toBe('material')
    }
  })

  test('the old drops did not move', () => {
    expect(dropForBlock(BLOCK.ore_coal)).toBe('coal')
    expect(dropForBlock(BLOCK.ore_iron)).toBe('iron')
    expect(dropForBlock(BLOCK.stone)).toBe('cobble')
    expect(dropForBlock(BLOCK.grass)).toBe('dirt')
    expect(dropForBlock(BLOCK.water)).toBe(null)
  })

  test('the pickaxe ladder breaking times are unchanged for the old tools', () => {
    // the tier/speed split must not have re-balanced what was already there
    expect(breakTime(BLOCK.stone, 'pickaxe_wood')).toBeCloseTo(5 / 1.5)
    expect(breakTime(BLOCK.ore_iron, 'pickaxe_stone')).toBeCloseTo(6 / 2.5)
    expect(breakTime(BLOCK.ore_coal, 'pickaxe_iron')).toBeCloseTo(5 / 4)
    expect(breakTime(BLOCK.dirt, null)).toBeCloseTo(0.75)
    expect(breakTime(BLOCK.stone, null)).toBe(Infinity)
    expect(breakTime(BLOCK.bedrock, 'pickaxe_diamond')).toBe(Infinity)
  })

  test('each ore needs its own tier of pickaxe and no less', () => {
    for (const o of ORES) {
      for (const p of PICKAXES) {
        const enough = mineTierOf(p) >= o.tier
        expect(Number.isFinite(breakTime(o.block, p)), `${p} on ${o.drop}`).toBe(enough)
      }
      expect(breakTime(o.block, null)).toBe(Infinity)
    }
  })

  test('the deep ores are gated behind iron, the shallow ones are not', () => {
    expect(breakTime(BLOCK.ore_coal, 'pickaxe_wood')).toBeLessThan(Infinity)
    expect(breakTime(BLOCK.ore_copper, 'pickaxe_wood')).toBe(Infinity)
    expect(breakTime(BLOCK.ore_copper, 'pickaxe_stone')).toBeLessThan(Infinity)
    for (const ore of [BLOCK.ore_gold, BLOCK.ore_redstone, BLOCK.ore_diamond, BLOCK.ore_emerald]) {
      expect(breakTime(ore, 'pickaxe_copper')).toBe(Infinity)
      expect(breakTime(ore, 'pickaxe_iron')).toBeLessThan(Infinity)
    }
  })

  test('gold digs faster than iron but cannot touch what iron opens', () => {
    expect(breakTime(BLOCK.stone, 'pickaxe_gold')).toBeLessThan(breakTime(BLOCK.stone, 'pickaxe_iron'))
    expect(breakTime(BLOCK.ore_diamond, 'pickaxe_gold')).toBe(Infinity)
    expect(mineTierOf('pickaxe_gold')).toBeLessThan(mineTierOf('pickaxe_iron'))
  })

  test('the ladder gets faster at every rung', () => {
    const speeds = PICKAXES.map(p => getItem(p).mineSpeed!)
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeGreaterThan(speeds[i - 1])
  })

  test('a prospector senses, and the attuned one senses further', () => {
    expect(getItem('prospector').senseRange).toBeGreaterThan(0)
    expect(getItem('prospector_far').senseRange!).toBeGreaterThan(getItem('prospector').senseRange!)
    // and nothing else in the game senses anything
    const sensing = Object.values(ITEMS).filter(i => i.senseRange).map(i => i.id)
    expect(sensing.sort()).toEqual(['prospector', 'prospector_far'])
  })
})

describe('mineral recipes', () => {
  const stocked = (have: Record<string, number>): Inventory => {
    const inv = new Inventory()
    for (const [id, n] of Object.entries(have)) inv.add(id, n)
    return inv
  }

  test('every recipe input is a real item and every output too', () => {
    for (const r of RECIPES) {
      expect(() => getItem(r.output.id)).not.toThrow()
      for (const i of r.inputs) expect(() => getItem(i.id)).not.toThrow()
    }
  })

  test('each new mineral has somewhere to go', () => {
    const used = new Set(RECIPES.flatMap(r => r.inputs.map(i => i.id)))
    for (const o of ORES) expect(used.has(o.drop), `${o.drop} is not used by any recipe`).toBe(true)
  })

  test('a prospector takes lapis, redstone and iron at a bench', () => {
    const r = getRecipe('prospector')
    expect(r.bench).toBe(true)
    const inv = stocked({ lapis: 2, redstone: 2, iron: 1 })
    expect(craftStatus(inv, r, false)).toBe('needsBench')
    expect(craftStatus(inv, r, true)).toBe('ok')
    craft(inv, r, true)
    expect(inv.count('prospector')).toBe(1)
    expect(inv.count('lapis')).toBe(0)
  })

  test('emeralds attune a prospector, consuming the plain one', () => {
    const inv = stocked({ prospector: 1, emerald: 2 })
    craft(inv, getRecipe('prospector_far'), true)
    expect(inv.count('prospector_far')).toBe(1)
    expect(inv.count('prospector')).toBe(0)
  })

  test('redstone ammo yields twice what coal ammo does for the same iron', () => {
    const coal = getRecipe('ammo')
    const red = getRecipe('ammo_redstone')
    expect(red.output.id).toBe('ammo')
    expect(red.output.count).toBe(coal.output.count * 2)
    const iron = (r: typeof coal): number => r.inputs.find(i => i.id === 'iron')!.count
    expect(iron(red)).toBe(iron(coal))
  })

  test('the diamond tools cost diamond and beat their iron counterparts', () => {
    expect(getRecipe('pickaxe_diamond').inputs.some(i => i.id === 'diamond')).toBe(true)
    expect(getRecipe('sword_diamond').inputs.some(i => i.id === 'diamond')).toBe(true)
    expect(getItem('pickaxe_diamond').mineTier!).toBeGreaterThan(getItem('pickaxe_iron').mineTier!)
  })
})
