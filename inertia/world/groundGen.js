import { BLOCK } from "./palette.js";
import { fractal2, hash01, PerlinNoise } from "./noise.js";
export const SEA_LEVEL = 32;
export const GROUND_MIN = 24;
export const GROUND_MAX = 52;
export const PAD_RADIUS = 8;
export const PAD_BLEND = 4;
export const DRY_RADIUS = 16;
export const TREE_DENSITY = 0.006;
export const TREE_SPACING = 3;
export const TREE_MIN_HEIGHT = 4;
export const TREE_MAX_HEIGHT = 6;
const SALT = { tree: 101, treeHeight: 102 };
const SLICE = { broad: 11, detail: 12, ridge: 13 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smoothstep = (t) => t * t * (3 - 2 * t);
export class GroundModel {
    seed;
    padHeight;
    n2;
    constructor(seed) {
        this.seed = seed;
        this.n2 = fractal2(new PerlinNoise(seed ^ 0x5eed));
        this.padHeight = this.computePadHeight();
    }
    naturalHeight(x, z) {
        const broad = this.n2(x, z, this.seed + SLICE.broad, 0.011);
        const detail = this.n2(x, z, this.seed + SLICE.detail, 0.045);
        const ridge = this.n2(x, z, this.seed + SLICE.ridge, 0.02);
        let h = 36 + 9 * broad + 2.5 * detail;
        if (ridge > 0.55)
            h += Math.min(1, (ridge - 0.55) * 4) * 9;
        return clamp(Math.round(h), GROUND_MIN, GROUND_MAX);
    }
    height(x, z) {
        const d = Math.hypot(x, z);
        if (d <= PAD_RADIUS)
            return this.padHeight;
        const nat = Math.max(this.naturalHeight(x, z), Math.ceil(SEA_LEVEL + 2 - Math.max(0, d - DRY_RADIUS)));
        if (d > PAD_RADIUS + PAD_BLEND)
            return nat;
        const t = smoothstep((d - PAD_RADIUS) / PAD_BLEND);
        return Math.round(this.padHeight + (nat - this.padHeight) * t);
    }
    static surfaceFor(h) {
        return h <= SEA_LEVEL + 1 ? BLOCK.sand : BLOCK.grass;
    }
    treeHeight(x, z, heightAt) {
        const r = hash01(this.seed, x, z, SALT.tree);
        if (r >= TREE_DENSITY)
            return 0;
        if (GroundModel.surfaceFor(heightAt(x, z)) !== BLOCK.grass)
            return 0;
        if (Math.hypot(x, z) <= PAD_RADIUS + PAD_BLEND + 2)
            return 0;
        for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
                if (heightAt(x + dx, z + dz) < SEA_LEVEL)
                    return 0;
            }
        }
        for (let dx = -TREE_SPACING; dx <= TREE_SPACING; dx++) {
            for (let dz = -TREE_SPACING; dz <= TREE_SPACING; dz++) {
                if (!dx && !dz)
                    continue;
                const r2 = hash01(this.seed, x + dx, z + dz, SALT.tree);
                if (r2 < TREE_DENSITY && (r2 < r || (r2 === r && (dx < 0 || (dx === 0 && dz < 0)))))
                    return 0;
            }
        }
        return TREE_MIN_HEIGHT + Math.floor(hash01(this.seed, x, z, SALT.treeHeight) * (TREE_MAX_HEIGHT - TREE_MIN_HEIGHT + 1));
    }
    computePadHeight() {
        const ring = [];
        const outer = PAD_RADIUS + 3;
        for (let x = -outer; x <= outer; x++) {
            for (let z = -outer; z <= outer; z++) {
                const d = Math.hypot(x, z);
                if (d > PAD_RADIUS && d <= outer)
                    ring.push(this.naturalHeight(x, z));
            }
        }
        ring.sort((a, b) => a - b);
        return Math.max(SEA_LEVEL + 2, ring[ring.length >> 1]);
    }
}
//# sourceMappingURL=groundGen.js.map