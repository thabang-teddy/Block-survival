import { hashInt, makeRng, PerlinNoise } from "./noise.js";
import { BLOCK } from "./palette.js";
import { ORES } from "./ores.js";
import { CHUNK, localIndex } from "./chunkStore.js";
const CAVE_FREQ = 0.035;
const CAVE_SQUASH = 1.7;
const CAVE_MIN_R = 0.05;
const CAVE_MAX_R = 0.105;
const CAVE_WIDEN_OVER = 24;
export const CAVE_ROOF = 5;
export const CAVE_FLOOR = 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export class CaveModel {
    a;
    b;
    padRadiusSq;
    constructor(seed, padRadius) {
        this.a = new PerlinNoise(seed ^ 0xca7e5);
        this.b = new PerlinNoise(seed ^ 0x7c0a1);
        this.padRadiusSq = padRadius * padRadius;
    }
    open(x, y, z, h) {
        if (y <= CAVE_FLOOR || y > h - CAVE_ROOF)
            return false;
        if (x * x + z * z <= this.padRadiusSq)
            return false;
        const fx = x * CAVE_FREQ;
        const fy = y * CAVE_FREQ * CAVE_SQUASH;
        const fz = z * CAVE_FREQ;
        const na = this.a.noise(fx, fy, fz);
        const nb = this.b.noise(fx, fy, fz);
        const t = clamp01((h - CAVE_ROOF - y) / CAVE_WIDEN_OVER);
        const r = CAVE_MIN_R + (CAVE_MAX_R - CAVE_MIN_R) * t;
        return na * na + nb * nb < r * r;
    }
}
export const VEIN_CELL = 8;
export const VEIN_REACH = 5;
const SALT_VEIN = 4001;
const BAND_MIN = Math.min(...ORES.map(o => o.minY));
const BAND_MAX = Math.max(...ORES.map(o => o.maxY));
const VEIN_CACHE = 8192;
const CELL_HALF = 1 << 20;
const CELL_SPAN = CELL_HALF * 2;
const CELL_Y_HALF = 32;
const cellKey = (gx, gy, gz) => ((gx + CELL_HALF) * CELL_SPAN + (gz + CELL_HALF)) * (CELL_Y_HALF * 2) + (gy + CELL_Y_HALF);
export class VeinField {
    seed;
    cache = new Map();
    constructor(seed) {
        this.seed = seed;
    }
    in(gx, gy, gz) {
        if (gy * VEIN_CELL > BAND_MAX || gy * VEIN_CELL + VEIN_CELL - 1 < BAND_MIN)
            return null;
        const key = cellKey(gx, gy, gz);
        const hit = this.cache.get(key);
        if (hit !== undefined)
            return hit;
        const rng = makeRng(hashInt(this.seed ^ SALT_VEIN, gx, gy, gz));
        const x = gx * VEIN_CELL + rng.randint(0, VEIN_CELL - 1);
        const y = gy * VEIN_CELL + rng.randint(0, VEIN_CELL - 1);
        const z = gz * VEIN_CELL + rng.randint(0, VEIN_CELL - 1);
        const roll = rng.random();
        let acc = 0;
        let ore = null;
        for (const o of ORES) {
            if (y < o.minY || y > o.maxY)
                continue;
            acc += o.chance;
            if (roll < acc) {
                ore = o;
                break;
            }
        }
        const vein = ore ? { ore, x, y, z, offsets: walk(rng, rng.randint(ore.size[0], ore.size[1])) } : null;
        if (this.cache.size >= VEIN_CACHE)
            this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, vein);
        return vein;
    }
    near(x0, y0, z0, x1, y1, z1) {
        const out = [];
        const gx1 = Math.floor((x1 + VEIN_REACH) / VEIN_CELL);
        const gy1 = Math.floor((y1 + VEIN_REACH) / VEIN_CELL);
        const gz1 = Math.floor((z1 + VEIN_REACH) / VEIN_CELL);
        for (let gx = Math.floor((x0 - VEIN_REACH) / VEIN_CELL); gx <= gx1; gx++) {
            for (let gy = Math.floor((y0 - VEIN_REACH) / VEIN_CELL); gy <= gy1; gy++) {
                for (let gz = Math.floor((z0 - VEIN_REACH) / VEIN_CELL); gz <= gz1; gz++) {
                    const v = this.in(gx, gy, gz);
                    if (v)
                        out.push(v);
                }
            }
        }
        return out;
    }
}
function walk(rng, count) {
    const out = new Int8Array(count * 3);
    const seen = new Set([0]);
    let x = 0;
    let y = 0;
    let z = 0;
    let n = 1;
    for (let guard = 0; n < count && guard < count * 8; guard++) {
        const axis = rng.randint(0, 2);
        const step = rng.randint(0, 1) * 2 - 1;
        const nx = x + (axis === 0 ? step : 0);
        const ny = y + (axis === 1 ? step : 0);
        const nz = z + (axis === 2 ? step : 0);
        if (Math.abs(nx) > VEIN_REACH || Math.abs(ny) > VEIN_REACH || Math.abs(nz) > VEIN_REACH)
            continue;
        x = nx;
        y = ny;
        z = nz;
        const k = ((x + VEIN_REACH) << 8) | ((y + VEIN_REACH) << 4) | (z + VEIN_REACH);
        if (seen.has(k))
            continue;
        seen.add(k);
        out[n * 3] = x;
        out[n * 3 + 1] = y;
        out[n * 3 + 2] = z;
        n++;
    }
    return n === count ? out : out.slice(0, n * 3);
}
export function stampVeins(data, veinList, x0, y0, z0) {
    let any = false;
    for (const v of veinList) {
        const o = v.offsets;
        for (let i = 0; i < o.length; i += 3) {
            const lx = v.x + o[i] - x0;
            const ly = v.y + o[i + 1] - y0;
            const lz = v.z + o[i + 2] - z0;
            if (lx < 0 || lx >= CHUNK || ly < 0 || ly >= CHUNK || lz < 0 || lz >= CHUNK)
                continue;
            const idx = localIndex(lx, ly, lz);
            if (data[idx] !== BLOCK.stone)
                continue;
            data[idx] = v.ore.block;
            any = true;
        }
    }
    return any;
}
export const aboveAllVeins = (y0) => y0 > BAND_MAX + VEIN_REACH;
//# sourceMappingURL=underground.js.map