/**
 * Item definitions: every placeable block, tool, weapon and material.
 * Block items share the id of their block name so `BLOCK[name]` resolves them.
 */
import { BLOCK, BLOCK_DEFS, BLOCK_NAMES, type BlockId, type BlockName, type Rgb } from '../world/palette.ts'
import { ORES, oreOf } from '../world/ores.ts'

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
  /**
   * How hard a block this may break: 1 wood, 2 stone, 3 copper, 4 iron, 5 diamond.
   * Separate from `mineSpeed` on purpose — gold digs faster than iron but, like
   * Minecraft's, is too soft for the ores iron opens up.
   */
  mineTier?: number
  /** how many times faster than bare hands this digs (bare hands = 1) */
  mineSpeed?: number
  /** prospector only: how far it senses ore, in metres (issue #25) */
  senseRange?: number
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
  n => n !== 'air' && n !== 'water' && n !== 'bedrock' && n !== 'torch' && n !== 'workbench' && n !== 'bed',
)

export const ITEMS: Readonly<Record<string, ItemDef>> = Object.fromEntries(
  [
    ...PLACEABLE.map(blockItem),
    { id: 'stick', name: 'stick', kind: 'material', maxStack: 64, colour: [0.55, 0.40, 0.22] },
    { id: 'coal', name: 'coal', kind: 'material', maxStack: 64, colour: [0.15, 0.15, 0.15] },
    { id: 'iron', name: 'iron', kind: 'material', maxStack: 64, colour: [0.80, 0.78, 0.74] },
    { id: 'copper', name: 'copper', kind: 'material', maxStack: 64, colour: [0.80, 0.50, 0.30] },
    { id: 'gold', name: 'gold', kind: 'material', maxStack: 64, colour: [0.95, 0.80, 0.30] },
    { id: 'redstone', name: 'redstone', kind: 'material', maxStack: 64, colour: [0.80, 0.16, 0.16] },
    { id: 'lapis', name: 'lapis', kind: 'material', maxStack: 64, colour: [0.22, 0.38, 0.85] },
    { id: 'diamond', name: 'diamond', kind: 'material', maxStack: 64, colour: [0.45, 0.90, 0.92] },
    { id: 'emerald', name: 'emerald', kind: 'material', maxStack: 64, colour: [0.24, 0.85, 0.46] },
    { id: 'pickaxe_wood', name: 'wooden pickaxe', kind: 'tool', maxStack: 1, model: MODEL('Pickaxe'), mineTier: 1, mineSpeed: 1.5, colour: [0.55, 0.40, 0.22] },
    { id: 'pickaxe_stone', name: 'stone pickaxe', kind: 'tool', maxStack: 1, model: MODEL('Pickaxe'), mineTier: 2, mineSpeed: 2.5, colour: [0.5, 0.5, 0.5] },
    { id: 'pickaxe_copper', name: 'copper pickaxe', kind: 'tool', maxStack: 1, model: MODEL('Pickaxe'), mineTier: 3, mineSpeed: 3.2, colour: [0.80, 0.50, 0.30] },
    { id: 'pickaxe_iron', name: 'iron pickaxe', kind: 'tool', maxStack: 1, model: MODEL('Pickaxe'), mineTier: 4, mineSpeed: 4, colour: [0.8, 0.78, 0.74] },
    // soft: it flies through stone but cannot bite the ores iron opens (Minecraft's gold)
    { id: 'pickaxe_gold', name: 'golden pickaxe', kind: 'tool', maxStack: 1, model: MODEL('Pickaxe'), mineTier: 2, mineSpeed: 6.5, colour: [0.95, 0.80, 0.30] },
    { id: 'pickaxe_diamond', name: 'diamond pickaxe', kind: 'tool', maxStack: 1, model: MODEL('Pickaxe'), mineTier: 5, mineSpeed: 7, colour: [0.45, 0.90, 0.92] },
    // the finder of issue #25, in three rungs: a whittled one you can have in the first
    // minute, then lapis and redstone to see further, then emerald
    { id: 'prospector', name: 'prospector', kind: 'tool', maxStack: 1, senseRange: 16, colour: [0.55, 0.40, 0.22] },
    { id: 'prospector_tuned', name: 'tuned prospector', kind: 'tool', maxStack: 1, senseRange: 32, colour: [0.22, 0.38, 0.85] },
    { id: 'prospector_far', name: 'attuned prospector', kind: 'tool', maxStack: 1, senseRange: 64, colour: [0.24, 0.85, 0.46] },
    { id: 'sword', name: 'sword', kind: 'weapon', maxStack: 1, model: MODEL('Sword'), colour: [0.85, 0.65, 0.20] },
    { id: 'sword_diamond', name: 'diamond sword', kind: 'weapon', maxStack: 1, model: MODEL('Sword'), colour: [0.45, 0.90, 0.92] },
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
    default: return oreOf(id)?.drop ?? BLOCK_NAMES[id]
  }
}

/** Seconds to break by hand, before the tool's speed divides it. */
const HARDNESS: Readonly<Record<number, number>> = {
  [BLOCK.grass]: 0.9, [BLOCK.dirt]: 0.75, [BLOCK.sand]: 0.75, [BLOCK.gravel]: 0.9,
  [BLOCK.snow]: 0.4, [BLOCK.leaves]: 0.35, [BLOCK.glass]: 0.5,
  [BLOCK.log]: 3, [BLOCK.planks]: 2.2,
  [BLOCK.stone]: 5, [BLOCK.cobble]: 4.5,
  [BLOCK.torch]: 0.2, [BLOCK.workbench]: 1.5, [BLOCK.bed]: 1.0, [BLOCK.reinforced_wall]: 9,
  ...Object.fromEntries(ORES.map(o => [o.block, o.hardness])),
}

/**
 * The pickaxe tier a block demands; anything missing can be broken by hand. Ores bring
 * their own from the ore table, which is what gates the deep ones behind iron.
 */
const MINE_TIER: Readonly<Record<number, number>> = {
  [BLOCK.stone]: 1, [BLOCK.cobble]: 1, [BLOCK.reinforced_wall]: 2,
  ...Object.fromEntries(ORES.map(o => [o.block, o.tier])),
}

/** The pickaxe tier `item` has (0 = not a pickaxe, which still breaks soil and wood). */
export const mineTierOf = (itemId: string | null): number => (itemId ? ITEMS[itemId]?.mineTier ?? 0 : 0)

/** Seconds to break `block` holding `item` (Infinity = cannot). */
export function breakTime(block: number, heldItemId: string | null): number {
  const base = HARDNESS[block]
  if (base === undefined) return Infinity
  const def = heldItemId ? ITEMS[heldItemId] : undefined
  if ((MINE_TIER[block] ?? 0) > (def?.mineTier ?? 0)) return Infinity
  return base / (def?.mineSpeed ?? 1)
}
