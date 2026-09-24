import { ISLAND_LARGE } from "./islandGen.js";
import { IslandTemplate } from "./islandTemplate.js";
import { hash01, hashInt } from "./noise.js";
export const ISLAND_CELL = 96;
export const ISLAND_CHANCE = 0.5;
export const ISLAND_MIN_Y = 80;
export const ISLAND_MAX_Y = 96;
export const LEGACY_ISLAND_Y = 80;
const MAX_HALF_EXTENT = 33;
const TEMPLATE_CACHE = 48;
const SALT = { exists: 1, offsetX: 2, offsetZ: 3, size: 4, height: 5, depth: 6, lake: 7, seed: 8, baseY: 9 };
export function islandAtCell(seed, ix, iz) {
    if (ix === 0 && iz === 0)
        return { ix, iz, x: 0, z: 0, baseY: LEGACY_ISLAND_Y, params: ISLAND_LARGE };
    if (hash01(seed, ix, iz, SALT.exists) >= ISLAND_CHANCE)
        return null;
    const size = 24 + 2 * Math.floor(hash01(seed, ix, iz, SALT.size) * 17);
    const maxJitter = ISLAND_CELL / 2 - MAX_HALF_EXTENT;
    const jx = (hash01(seed, ix, iz, SALT.offsetX) * 2 - 1) * maxJitter;
    const jz = (hash01(seed, ix, iz, SALT.offsetZ) * 2 - 1) * maxJitter;
    return {
        ix, iz,
        x: Math.round(ix * ISLAND_CELL + ISLAND_CELL / 2 + jx),
        z: Math.round(iz * ISLAND_CELL + ISLAND_CELL / 2 + jz),
        baseY: ISLAND_MIN_Y + Math.floor(hash01(seed, ix, iz, SALT.baseY) * (ISLAND_MAX_Y - ISLAND_MIN_Y + 1)),
        params: {
            size,
            seed: hashInt(seed, ix, iz, SALT.seed),
            maxHeight: 5 + Math.floor(hash01(seed, ix, iz, SALT.height) * 5),
            depth: 9 + Math.floor(hash01(seed, ix, iz, SALT.depth) * 8),
            padRadius: 0,
            lake: hash01(seed, ix, iz, SALT.lake) < 0.4,
            treeDensity: 0.022,
        },
    };
}
export function islandsNear(seed, x0, z0, x1, z1) {
    const out = [];
    const ix0 = Math.floor((x0 - MAX_HALF_EXTENT) / ISLAND_CELL);
    const ix1 = Math.floor((x1 + MAX_HALF_EXTENT) / ISLAND_CELL);
    const iz0 = Math.floor((z0 - MAX_HALF_EXTENT) / ISLAND_CELL);
    const iz1 = Math.floor((z1 + MAX_HALF_EXTENT) / ISLAND_CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
            const island = islandAtCell(seed, ix, iz);
            if (!island)
                continue;
            if (island.x + MAX_HALF_EXTENT < x0 || island.x - MAX_HALF_EXTENT > x1)
                continue;
            if (island.z + MAX_HALF_EXTENT < z0 || island.z - MAX_HALF_EXTENT > z1)
                continue;
            out.push(island);
        }
    }
    return out;
}
export class IslandTemplates {
    cache = new Map();
    get(island) {
        const key = `${island.ix},${island.iz}`;
        let t = this.cache.get(key);
        if (t) {
            this.cache.delete(key);
            this.cache.set(key, t);
            return t;
        }
        t = new IslandTemplate(island.params);
        if (this.cache.size >= TEMPLATE_CACHE)
            this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, t);
        return t;
    }
}
//# sourceMappingURL=islandField.js.map