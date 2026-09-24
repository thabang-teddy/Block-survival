import { CHUNK, columnFromKey, columnKey } from "./chunkStore.js";
export const LOAD_RADIUS = 7;
export const UNLOAD_MARGIN = 2;
export const LOAD_BUDGET_MS = 6;
const UNLOAD_PER_FRAME = 8;
const colKeyOf = (cx, cz) => columnKey(cx, cz);
function nearestAnchorDist2(cx, cz, anchors) {
    let best = Infinity;
    for (const a of anchors) {
        const dx = a.x / CHUNK - (cx + 0.5);
        const dz = a.z / CHUNK - (cz + 0.5);
        const d2 = dx * dx + dz * dz;
        if (d2 < best)
            best = d2;
    }
    return best;
}
export function planStream(loaded, anchors, keep, radius, margin) {
    const load = [];
    const wanted = new Set();
    const r2 = (radius + 0.5) * (radius + 0.5);
    for (const a of anchors) {
        const acx = Math.floor(a.x / CHUNK);
        const acz = Math.floor(a.z / CHUNK);
        for (let cx = acx - radius; cx <= acx + radius; cx++) {
            for (let cz = acz - radius; cz <= acz + radius; cz++) {
                const key = colKeyOf(cx, cz);
                if (wanted.has(key))
                    continue;
                const d2 = nearestAnchorDist2(cx, cz, anchors);
                if (d2 > r2)
                    continue;
                wanted.add(key);
                if (!loaded.has(key))
                    load.push({ cx, cz, d2 });
            }
        }
    }
    load.sort((a, b) => a.d2 - b.d2);
    const keepKeys = new Set();
    for (const k of keep)
        keepKeys.add(colKeyOf(Math.floor(k.x / CHUNK), Math.floor(k.z / CHUNK)));
    const unload = [];
    const keepR2 = (radius + margin + 0.5) * (radius + margin + 0.5);
    for (const key of loaded) {
        if (wanted.has(key) || keepKeys.has(key))
            continue;
        const { cx, cz } = columnFromKey(key);
        if (nearestAnchorDist2(cx, cz, anchors) > keepR2)
            unload.push({ cx, cz });
    }
    return { load: load.map(({ cx, cz }) => ({ cx, cz })), unload };
}
export class ChunkStreamer {
    radius;
    budgetMs;
    world;
    loaded = new Set();
    constructor(world, opts = {}) {
        this.world = world;
        this.radius = opts.radius ?? LOAD_RADIUS;
        this.budgetMs = opts.budgetMs ?? LOAD_BUDGET_MS;
    }
    get loadedCount() {
        return this.loaded.size;
    }
    loadNow(x, z, radius) {
        const plan = planStream(this.loaded, [{ x, z }], [], radius, 0);
        for (const c of plan.load)
            this.load(c.cx, c.cz);
    }
    update(anchors, keep = [], now = performance.now()) {
        if (!anchors.length)
            return;
        const plan = planStream(this.loaded, anchors, keep, this.radius, UNLOAD_MARGIN);
        for (let i = 0; i < plan.unload.length && i < UNLOAD_PER_FRAME; i++) {
            const c = plan.unload[i];
            this.world.unloadColumn(c.cx, c.cz);
            this.loaded.delete(colKeyOf(c.cx, c.cz));
        }
        const deadline = now + this.budgetMs;
        for (const c of plan.load) {
            this.load(c.cx, c.cz);
            if (performance.now() >= deadline)
                break;
        }
    }
    load(cx, cz) {
        this.world.loadColumn(cx, cz);
        this.loaded.add(colKeyOf(cx, cz));
    }
}
//# sourceMappingURL=chunkStreamer.js.map