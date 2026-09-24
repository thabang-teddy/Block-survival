import { ISLAND_LARGE } from "./islandGen.js";
export const GLOBAL_SEED = ISLAND_LARGE.seed;
export function newWorldSeed(random = cryptoRandom) {
    for (;;) {
        const seed = Math.floor(random() * 0x7fffffff);
        if (seed !== GLOBAL_SEED && seed > 0)
            return seed;
    }
}
function cryptoRandom() {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 0x100000000;
}
export const seedTag = (seed) => `#${(seed >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
//# sourceMappingURL=seed.js.map