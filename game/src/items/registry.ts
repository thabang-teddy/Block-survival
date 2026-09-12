/**
 * Item definitions: every placeable block, tool, weapon and material.
 * Block items share the id of their block name so `BLOCK[name]` resolves them.
 */
import { BLOCK, BLOCK_DEFS, BLOCK_NAMES, type BlockId, type BlockName, type Rgb } from '../world/palette'

export type ItemKind = 'block' | 'tool' | 'weapon' | 'material' | 'prop'

export interface ItemDef {
  id: string
  name: string
  kind: ItemKind
  maxStack: number
  /** block placed when used (block items only) */
  block?: BlockId
  /** GLB under /assets used for the held view-model and drops */
  model?: string
  /** pickaxe tier: 1 wood, 2 stone, 3 iron */
  pickaxeTier?: number
  /** swatch colour for the HUD icon */
  colour: Rgb
}

const MODEL = (name: string): string => `/assets/Assets/${name}.glb`

const blockItem = (name: BlockName): ItemDef => ({
  id: name,
  name: name.replace('_', ' '),
  kind: 'block',
  maxStack: 64,
  block: BLOCK[name],
  colour: BLOCK_DEFS[BLOCK[name]].colours[0],
})

/** props get bespoke item defs below */
const PLACEABLE: readonly BlockName[] = BLOCK_NAMES.filter(
  n => n !== 'air' && n !== 'water' && n !== 'torch' && n !== 'workbench' && n !== 'bed',
)

export const ITEMS: Readonly<Record<string, ItemDef>> = Object.fromEntries(
  [
    ...PLACEABLE.map(blockItem),
    { id: 'stick', name: 'stick', kind: 'material', maxStack: 64, colour: [0.55, 0.40, 0.22] },
    { id: 'coal', name: 'coal', kind: 'material', maxStack: 64, colour: [0.15, 0.15, 0.15] },
    { id: 'iron', name: 'iron', kind: 'material', maxStack: 64, colour: [0.80, 0.78, 0.74] },
    { id: 'pickaxe_wood', name: 'wooden pickaxe', kind: 'tool', maxStack: 1, model: MODEL('Pickaxe'), pickaxeTier: 1, colour: [0.55, 0.40, 0.22] },
    { id: 'pickaxe_stone', name: 'stone pickaxe', kind: 'tool', maxStack: 1, model: MODEL('Pickaxe'), pickaxeTier: 2, colour: [0.5, 0.5, 0.5] },
    { id: 'pickaxe_iron', name: 'iron pickaxe', kind: 'tool', maxStack: 1, model: MODEL('Pickaxe'), pickaxeTier: 3, colour: [0.8, 0.78, 0.74] },
    { id: 'sword', name: 'sword', kind: 'weapon', maxStack: 1, model: MODEL('Sword'), colour: [0.85, 0.65, 0.20] },
    { id: 'rifle', name: 'rifle', kind: 'weapon', maxStack: 1, model: MODEL('Rifle'), colour: [0.62, 0.52, 0.34] },
    { id: 'ammo', name: 'rifle ammo', kind: 'material', maxStack: 120, colour: [0.75, 0.62, 0.30] },
    { id: 'torch', name: 'torch', kind: 'prop', maxStack: 64, model: MODEL('Torch'), block: BLOCK.torch, colour: [1.0, 0.55, 0.10] },
    { id: 'workbench', name: 'workbench', kind: 'prop', maxStack: 8, model: MODEL('Workbench'), block: BLOCK.workbench, colour: [0.58, 0.44, 0.26] },
    { id: 'bed', name: 'bed', kind: 'prop', maxStack: 1, model: MODEL('Bed'), block: BLOCK.bed, colour: [0.35, 0.45, 0.30] },
  ].map(d => [d.id, d as ItemDef]),
)

export const getItem = (id: string): ItemDef => {
  const def = ITEMS[id]
  if (!def) throw new Error(`unknown item: ${id}`)
  return def
}

/** What a broken block drops (null = nothing). */
export function dropForBlock(id: number): string | null {
  switch (id) {
    case BLOCK.air:
    case BLOCK.water: return null
    case BLOCK.grass: return 'dirt'
    case BLOCK.stone: return 'cobble' // Minecraft convention; cobble is the wall block
    case BLOCK.ore_coal: return 'coal'
    case BLOCK.ore_iron: return 'iron'
    default: return BLOCK_NAMES[id]
  }
}

/** Seconds to break by hand. Blocks needing a pickaxe cannot be broken without one. */
const HARDNESS: Readonly<Record<number, number>> = {
  [BLOCK.grass]: 0.9, [BLOCK.dirt]: 0.75, [BLOCK.sand]: 0.75, [BLOCK.gravel]: 0.9,
  [BLOCK.snow]: 0.4, [BLOCK.leaves]: 0.35, [BLOCK.glass]: 0.5,
  [BLOCK.log]: 3, [BLOCK.planks]: 2.2,
  [BLOCK.stone]: 5, [BLOCK.cobble]: 4.5, [BLOCK.ore_coal]: 5, [BLOCK.ore_iron]: 6,
  [BLOCK.torch]: 0.2, [BLOCK.workbench]: 1.5, [BLOCK.bed]: 1.0, [BLOCK.reinforced_wall]: 9,
}
const NEEDS_PICKAXE = new Set<number>([BLOCK.stone, BLOCK.cobble, BLOCK.ore_coal, BLOCK.ore_iron, BLOCK.reinforced_wall])
const PICKAXE_SPEED = [1, 1.5, 2.5, 4] as const

/** Seconds to break `block` holding `item` (Infinity = cannot). */
export function breakTime(block: number, heldItemId: string | null): number {
  const base = HARDNESS[block]
  if (base === undefined) return Infinity
  const tier = heldItemId ? (ITEMS[heldItemId]?.pickaxeTier ?? 0) : 0
  if (NEEDS_PICKAXE.has(block) && tier === 0) return Infinity
  return base / PICKAXE_SPEED[tier]
}
