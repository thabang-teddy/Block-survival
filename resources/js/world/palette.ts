/**
 * Block palette — direct port of BLOCK_COLOURS / TRANSPARENT / SEE_THROUGH from
 * Design/blender_scripts/blocks.py. Block ids are Uint8 values stored in chunks.
 */
export type Rgb = readonly [number, number, number]

export const AIR = 0

export const BLOCK = {
  air: 0,
  grass: 1,
  dirt: 2,
  stone: 3,
  cobble: 4,
  sand: 5,
  gravel: 6,
  log: 7,
  planks: 8,
  leaves: 9,
  water: 10,
  glass: 11,
  snow: 12,
  ore_iron: 13,
  ore_coal: 14,
  // ---- Phase 3: props (rendered as GLB models, not chunk faces) and crafted blocks
  torch: 15,
  workbench: 16,
  bed: 17,
  reinforced_wall: 18,
} as const

export type BlockId = (typeof BLOCK)[keyof typeof BLOCK]
export type BlockName = keyof typeof BLOCK

export const BLOCK_NAMES: readonly BlockName[] = [
  'air', 'grass', 'dirt', 'stone', 'cobble', 'sand', 'gravel', 'log',
  'planks', 'leaves', 'water', 'glass', 'snow', 'ore_iron', 'ore_coal',
  'torch', 'workbench', 'bed', 'reinforced_wall',
]

interface BlockDef {
  /** (top, side, bottom) colours, linear RGB 0..1 */
  colours: readonly [Rgb, Rgb, Rgb]
  /** 1 = opaque */
  alpha: number
  /** faces of neighbours are still drawn against this block */
  seeThrough: boolean
  /** blocks player movement */
  solid: boolean
  /** drawn as a placed GLB model by the PropRenderer instead of chunk faces */
  prop?: boolean
  /** gives off light (PropRenderer assigns a PointLight to the nearest few) */
  light?: boolean
}

const solidRgb = (c: Rgb): readonly [Rgb, Rgb, Rgb] => [c, c, c]

export const BLOCK_DEFS: Readonly<Record<BlockId, BlockDef>> = {
  [BLOCK.air]: { colours: solidRgb([0, 0, 0]), alpha: 0, seeThrough: true, solid: false },
  [BLOCK.grass]: {
    colours: [[0.40, 0.66, 0.24], [0.52, 0.36, 0.20], [0.52, 0.36, 0.20]],
    alpha: 1, seeThrough: false, solid: true,
  },
  [BLOCK.dirt]: { colours: solidRgb([0.52, 0.36, 0.20]), alpha: 1, seeThrough: false, solid: true },
  [BLOCK.stone]: { colours: solidRgb([0.52, 0.52, 0.52]), alpha: 1, seeThrough: false, solid: true },
  [BLOCK.cobble]: { colours: solidRgb([0.44, 0.44, 0.46]), alpha: 1, seeThrough: false, solid: true },
  [BLOCK.sand]: { colours: solidRgb([0.86, 0.80, 0.58]), alpha: 1, seeThrough: false, solid: true },
  [BLOCK.gravel]: { colours: solidRgb([0.58, 0.55, 0.52]), alpha: 1, seeThrough: false, solid: true },
  [BLOCK.log]: {
    colours: [[0.70, 0.58, 0.36], [0.40, 0.28, 0.15], [0.70, 0.58, 0.36]],
    alpha: 1, seeThrough: false, solid: true,
  },
  [BLOCK.planks]: { colours: solidRgb([0.72, 0.56, 0.34]), alpha: 1, seeThrough: false, solid: true },
  [BLOCK.leaves]: { colours: solidRgb([0.24, 0.52, 0.18]), alpha: 1, seeThrough: true, solid: true },
  [BLOCK.water]: { colours: solidRgb([0.22, 0.48, 0.85]), alpha: 0.75, seeThrough: true, solid: false },
  [BLOCK.glass]: { colours: solidRgb([0.75, 0.88, 0.95]), alpha: 0.35, seeThrough: true, solid: true },
  [BLOCK.snow]: { colours: solidRgb([0.95, 0.96, 0.98]), alpha: 1, seeThrough: false, solid: true },
  [BLOCK.ore_iron]: { colours: solidRgb([0.62, 0.55, 0.48]), alpha: 1, seeThrough: false, solid: true },
  [BLOCK.ore_coal]: { colours: solidRgb([0.30, 0.30, 0.30]), alpha: 1, seeThrough: false, solid: true },
  [BLOCK.torch]: { colours: solidRgb([1.0, 0.55, 0.10]), alpha: 1, seeThrough: true, solid: false, prop: true, light: true },
  [BLOCK.workbench]: { colours: solidRgb([0.58, 0.44, 0.26]), alpha: 1, seeThrough: true, solid: true, prop: true },
  [BLOCK.bed]: { colours: solidRgb([0.35, 0.45, 0.30]), alpha: 1, seeThrough: true, solid: false, prop: true },
  [BLOCK.reinforced_wall]: {
    colours: [[0.36, 0.38, 0.40], [0.30, 0.32, 0.35], [0.30, 0.32, 0.35]],
    alpha: 1, seeThrough: false, solid: true,
  },
}

export const isSolid = (id: number): boolean => BLOCK_DEFS[id as BlockId]?.solid ?? false
export const isSeeThrough = (id: number): boolean => BLOCK_DEFS[id as BlockId]?.seeThrough ?? true
export const isTranslucent = (id: number): boolean => (BLOCK_DEFS[id as BlockId]?.alpha ?? 0) < 1 && id !== AIR
export const isProp = (id: number): boolean => BLOCK_DEFS[id as BlockId]?.prop ?? false
