/**
 * Recipe table (GAME_PROMPT.md §5) and the pure crafting rules.
 * By hand (E, anywhere) you can only make planks, sticks, a workbench and a wooden
 * pickaxe; a Workbench within reach (F) makes everything except another workbench
 * (issue #10). `craftStatus` is the one rule the host enforces; `recipesFor` is what
 * the panel lists.
 */
import type { Inventory, ItemStack } from './inventory.ts'

export interface Recipe {
  id: string
  output: ItemStack
  inputs: readonly ItemStack[]
  bench: boolean
}

const r = (id: string, output: [string, number], inputs: [string, number][], bench: boolean): Recipe => ({
  id,
  output: { id: output[0], count: output[1] },
  inputs: inputs.map(([iid, count]) => ({ id: iid, count })),
  bench,
})

export const RECIPES: readonly Recipe[] = [
  r('planks', ['planks', 4], [['log', 1]], false),
  r('stick', ['stick', 4], [['planks', 2]], false),
  r('workbench', ['workbench', 1], [['planks', 4]], false),
  r('torch', ['torch', 4], [['stick', 1], ['coal', 1]], true),
  r('pickaxe_wood', ['pickaxe_wood', 1], [['planks', 3], ['stick', 2]], false),
  r('pickaxe_stone', ['pickaxe_stone', 1], [['cobble', 3], ['stick', 2]], true),
  r('pickaxe_copper', ['pickaxe_copper', 1], [['copper', 3], ['stick', 2]], true),
  r('pickaxe_iron', ['pickaxe_iron', 1], [['iron', 3], ['stick', 2]], true),
  r('pickaxe_gold', ['pickaxe_gold', 1], [['gold', 3], ['stick', 2]], true),
  r('pickaxe_diamond', ['pickaxe_diamond', 1], [['diamond', 3], ['stick', 2]], true),
  r('sword', ['sword', 1], [['iron', 2], ['stick', 1]], true),
  r('sword_diamond', ['sword_diamond', 1], [['diamond', 2], ['stick', 1]], true),
  // issue #25: the thing that finds ore. The first one is whittled out of wood, so
  // finding your first iron does not depend on already having mined it; lapis and
  // redstone, then emerald, widen its reach from there.
  r('prospector', ['prospector', 1], [['planks', 4], ['stick', 2]], true),
  r('prospector_tuned', ['prospector_tuned', 1], [['prospector', 1], ['lapis', 2], ['redstone', 2], ['iron', 1]], true),
  r('prospector_far', ['prospector_far', 1], [['prospector_tuned', 1], ['emerald', 2]], true),
  r('glass', ['glass', 4], [['sand', 4], ['coal', 1]], true),
  r('reinforced_wall', ['reinforced_wall', 4], [['cobble', 4], ['iron', 1]], true),
  r('bed', ['bed', 1], [['planks', 3], ['leaves', 3]], true),
  r('rifle', ['rifle', 1], [['iron', 8], ['planks', 2], ['coal', 2]], true),
  r('ammo', ['ammo', 30], [['iron', 1], ['coal', 1]], true),
  // redstone burns hotter than coal: the same iron goes twice as far
  r('ammo_redstone', ['ammo', 60], [['iron', 1], ['redstone', 1]], true),
]

export type CraftContext = 'hand' | 'bench'

/** what the crafting panel lists: hand recipes anywhere, everything but the bench at a bench */
export function recipesFor(context: CraftContext): readonly Recipe[] {
  return context === 'hand' ? RECIPES.filter(r => !r.bench) : RECIPES.filter(r => r.id !== 'workbench')
}

export const getRecipe = (id: string): Recipe => {
  const rec = RECIPES.find(x => x.id === id)
  if (!rec) throw new Error(`unknown recipe: ${id}`)
  return rec
}

export type CraftStatus = 'ok' | 'missing' | 'needsBench'

export function craftStatus(inv: Inventory, recipe: Recipe, nearBench: boolean): CraftStatus {
  if (recipe.bench && !nearBench) return 'needsBench'
  return recipe.inputs.every(i => inv.count(i.id) >= i.count) ? 'ok' : 'missing'
}

/**
 * Consume the inputs and add the output. Output that does not fit is returned so the
 * caller can drop it on the ground. Returns null if the recipe cannot be crafted.
 */
export function craft(inv: Inventory, recipe: Recipe, nearBench: boolean): { overflow: number } | null {
  if (craftStatus(inv, recipe, nearBench) !== 'ok') return null
  for (const i of recipe.inputs) inv.remove(i.id, i.count)
  const overflow = inv.add(recipe.output.id, recipe.output.count)
  return { overflow }
}
