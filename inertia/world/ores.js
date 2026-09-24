import { BLOCK } from "./palette.js";
export const ORES = [
    { block: BLOCK.ore_coal, drop: 'coal', minY: 8, maxY: 60, chance: 0.22, size: [6, 14], tier: 1, hardness: 5, note: 'Everywhere below the soil — the first thing your wooden pickaxe can use.' },
    { block: BLOCK.ore_copper, drop: 'copper', minY: 6, maxY: 48, chance: 0.16, size: [5, 12], tier: 2, hardness: 5.5, note: 'Big shallow veins. A copper pickaxe is the cheap step up from stone.' },
    { block: BLOCK.ore_iron, drop: 'iron', minY: 4, maxY: 44, chance: 0.14, size: [4, 9], tier: 2, hardness: 6, note: 'Common all the way down. Iron opens the rifle, walls and the deep ores.' },
    { block: BLOCK.ore_lapis, drop: 'lapis', minY: 1, maxY: 26, chance: 0.05, size: [3, 7], tier: 2, hardness: 6, note: 'Deep and scattered. The lens of a prospector is cut from it.' },
    { block: BLOCK.ore_gold, drop: 'gold', minY: 2, maxY: 28, chance: 0.05, size: [3, 7], tier: 4, hardness: 6.5, note: 'Needs an iron pickaxe. Gold tools dig faster than anything but diamond.' },
    { block: BLOCK.ore_redstone, drop: 'redstone', minY: 1, maxY: 15, chance: 0.07, size: [4, 9], tier: 4, hardness: 6.5, note: 'Right down at the bottom. Doubles a batch of rifle ammo and powers the prospector.' },
    { block: BLOCK.ore_diamond, drop: 'diamond', minY: 1, maxY: 12, chance: 0.03, size: [2, 5], tier: 4, hardness: 7.5, note: 'The last twelve blocks above bedrock, in ones and twos. The best pickaxe and sword.' },
    { block: BLOCK.ore_emerald, drop: 'emerald', minY: 28, maxY: 50, chance: 0.08, size: [1, 3], tier: 4, hardness: 7.5, note: 'Ones and twos, and only inside high ground — there is no stone that high anywhere else.' },
];
export const ORE_BLOCKS = ORES.map(o => o.block);
const BY_BLOCK = new Map(ORES.map(o => [o.block, o]));
export const oreOf = (block) => BY_BLOCK.get(block);
export const isOre = (block) => BY_BLOCK.has(block);
export const oresAt = (y) => ORES.filter(o => y >= o.minY && y <= o.maxY);
export function depthBand(y) {
    if (y <= 12)
        return 'bedrock depths';
    if (y <= 28)
        return 'deep rock';
    if (y <= 48)
        return 'shallow rock';
    return 'high ground';
}
export function depthNote(y, surfaceY) {
    const under = Math.round(surfaceY - y);
    return under <= 0 ? 'above ground' : `${under} m down`;
}
//# sourceMappingURL=ores.js.map