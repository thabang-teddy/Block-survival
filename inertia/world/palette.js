export const AIR = 0;
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
    torch: 15,
    workbench: 16,
    bed: 17,
    reinforced_wall: 18,
    bedrock: 19,
    ore_copper: 20,
    ore_gold: 21,
    ore_redstone: 22,
    ore_lapis: 23,
    ore_diamond: 24,
    ore_emerald: 25,
};
export const BLOCK_NAMES = [
    'air', 'grass', 'dirt', 'stone', 'cobble', 'sand', 'gravel', 'log',
    'planks', 'leaves', 'water', 'glass', 'snow', 'ore_iron', 'ore_coal',
    'torch', 'workbench', 'bed', 'reinforced_wall', 'bedrock',
    'ore_copper', 'ore_gold', 'ore_redstone', 'ore_lapis', 'ore_diamond', 'ore_emerald',
];
const solidRgb = (c) => [c, c, c];
export const BLOCK_DEFS = {
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
    [BLOCK.bedrock]: { colours: solidRgb([0.18, 0.18, 0.20]), alpha: 1, seeThrough: false, solid: true },
    [BLOCK.ore_copper]: { colours: solidRgb([0.62, 0.42, 0.28]), alpha: 1, seeThrough: false, solid: true },
    [BLOCK.ore_gold]: { colours: solidRgb([0.85, 0.70, 0.25]), alpha: 1, seeThrough: false, solid: true },
    [BLOCK.ore_redstone]: { colours: solidRgb([0.62, 0.18, 0.18]), alpha: 1, seeThrough: false, solid: true },
    [BLOCK.ore_lapis]: { colours: solidRgb([0.20, 0.32, 0.68]), alpha: 1, seeThrough: false, solid: true },
    [BLOCK.ore_diamond]: { colours: solidRgb([0.42, 0.82, 0.85]), alpha: 1, seeThrough: false, solid: true },
    [BLOCK.ore_emerald]: { colours: solidRgb([0.22, 0.72, 0.40]), alpha: 1, seeThrough: false, solid: true },
};
export const isSolid = (id) => BLOCK_DEFS[id]?.solid ?? false;
export const isSeeThrough = (id) => BLOCK_DEFS[id]?.seeThrough ?? true;
export const isTranslucent = (id) => (BLOCK_DEFS[id]?.alpha ?? 0) < 1 && id !== AIR;
export const isProp = (id) => BLOCK_DEFS[id]?.prop ?? false;
//# sourceMappingURL=palette.js.map