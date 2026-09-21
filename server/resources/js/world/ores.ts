/**
 * The minerals of the world (issue #25) and where each one lives.
 *
 * One table serves three readers that must never disagree: the vein generator
 * (`underground.ts`) places ore by these depth bands, the item registry takes the
 * drop, hardness and pickaxe tier from here, and the HUD's minerals guide reads it
 * straight out to tell the player where to dig.
 *
 * Order is part of the contract: vein selection walks this array accumulating
 * `chance`, so moving a row changes every world.
 */
import { BLOCK, type BlockId } from './palette'

export interface OreDef {
  /** the block as it sits in the ground */
  block: BlockId
  /** item id it drops when broken */
  drop: string
  /** lowest y a vein of this ore is placed at */
  minY: number
  /** highest y a vein of this ore is placed at */
  maxY: number
  /** chance a vein cell inside the band holds this ore (see VEIN_CELL) */
  chance: number
  /** blocks in one vein, inclusive */
  size: readonly [number, number]
  /** pickaxe tier needed to break it (see items/registry) */
  tier: number
  /** seconds to break with bare hands, before the tool's speed divides it */
  hardness: number
  /** one line for the minerals guide */
  note: string
}

/**
 * Bands are roughly Minecraft's, squeezed into this world's 0–127 band: bedrock is
 * y 0, the sea sits at 32 and the ground runs 24–52, so "deep" here means single
 * digits. Emerald has no upper limit worth fussing over — it can only ever appear
 * where there is stone that high, which is under mountains.
 */
export const ORES: readonly OreDef[] = [
  { block: BLOCK.ore_coal, drop: 'coal', minY: 8, maxY: 60, chance: 0.22, size: [6, 14], tier: 1, hardness: 5, note: 'Everywhere below the soil — the first thing your wooden pickaxe can use.' },
  { block: BLOCK.ore_copper, drop: 'copper', minY: 6, maxY: 48, chance: 0.16, size: [5, 12], tier: 2, hardness: 5.5, note: 'Big shallow veins. A copper pickaxe is the cheap step up from stone.' },
  { block: BLOCK.ore_iron, drop: 'iron', minY: 4, maxY: 44, chance: 0.14, size: [4, 9], tier: 2, hardness: 6, note: 'Common all the way down. Iron opens the rifle, walls and the deep ores.' },
  { block: BLOCK.ore_lapis, drop: 'lapis', minY: 1, maxY: 26, chance: 0.05, size: [3, 7], tier: 2, hardness: 6, note: 'Deep and scattered. The lens of a prospector is cut from it.' },
  { block: BLOCK.ore_gold, drop: 'gold', minY: 2, maxY: 28, chance: 0.05, size: [3, 7], tier: 4, hardness: 6.5, note: 'Needs an iron pickaxe. Gold tools dig faster than anything but diamond.' },
  { block: BLOCK.ore_redstone, drop: 'redstone', minY: 1, maxY: 15, chance: 0.07, size: [4, 9], tier: 4, hardness: 6.5, note: 'Right down at the bottom. Doubles a batch of rifle ammo and powers the prospector.' },
  { block: BLOCK.ore_diamond, drop: 'diamond', minY: 1, maxY: 12, chance: 0.03, size: [2, 5], tier: 4, hardness: 7.5, note: 'The last twelve blocks above bedrock, in ones and twos. The best pickaxe and sword.' },
  { block: BLOCK.ore_emerald, drop: 'emerald', minY: 28, maxY: 50, chance: 0.08, size: [1, 3], tier: 4, hardness: 7.5, note: 'Ones and twos, and only inside high ground — there is no stone that high anywhere else.' },
]

export const ORE_BLOCKS: readonly BlockId[] = ORES.map(o => o.block)

const BY_BLOCK = new Map<number, OreDef>(ORES.map(o => [o.block, o]))

export const oreOf = (block: number): OreDef | undefined => BY_BLOCK.get(block)

export const isOre = (block: number): boolean => BY_BLOCK.has(block)

/** the ores whose band contains `y`, richest first — what the depth readout and the guide list */
export const oresAt = (y: number): readonly OreDef[] => ORES.filter(o => y >= o.minY && y <= o.maxY)

/**
 * What the ore bands call this height. This is about the rock, not about where the
 * player is: the ground runs y 24–52, so standing on grass at y 37 is "shallow" —
 * shallow *rock*, the depth coal and copper live at. How far down the player actually
 * is comes from `depthNote`, which needs the surface above them to say.
 */
export function depthBand(y: number): string {
  if (y <= 12) return 'bedrock depths'
  if (y <= 28) return 'deep rock'
  if (y <= 48) return 'shallow rock'
  return 'high ground'
}

/**
 * How far under the surface the player is, for the HUD. `surfaceY` is the top block
 * of their column; anything at or above it (including a sky island, which is far
 * above the ground below) is out in the open.
 */
export function depthNote(y: number, surfaceY: number): string {
  const under = Math.round(surfaceY - y)
  return under <= 0 ? 'above ground' : `${under} m down`
}
