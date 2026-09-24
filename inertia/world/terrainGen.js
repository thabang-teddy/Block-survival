import { CHUNK, localIndex } from "./chunkStore.js";
import { AIR, BLOCK } from "./palette.js";
import { GroundModel, PAD_BLEND, PAD_RADIUS, SEA_LEVEL, TREE_MAX_HEIGHT } from "./groundGen.js";
import { aboveAllVeins, CAVE_ROOF, CaveModel, stampVeins, VeinField } from "./underground.js";
import { islandsNear, IslandTemplates } from "./islandField.js";
import { updraftFor } from "./updraft.js";
export const WORLD_CHUNKS_Y = 8;
export const WORLD_HEIGHT = WORLD_CHUNKS_Y * CHUNK;
const BORDER = 4;
const CANOPY = 2;
const COLS = CHUNK + 2 * BORDER;
const COLUMN_CACHE = 512;
const UPDRAFT_REACH = 8;
export class TerrainGenerator {
    seed;
    ground;
    caves;
    veins;
    templates = new IslandTemplates();
    columns = new Map();
    updrafts = new Map();
    constructor(seed) {
        this.seed = seed;
        this.ground = new GroundModel(seed);
        this.caves = new CaveModel(seed, PAD_RADIUS + PAD_BLEND);
        this.veins = new VeinField(seed);
    }
    spawn() {
        return { x: 0.5, y: this.ground.padHeight + 1, z: 0.5 };
    }
    updraftOf(island) {
        const key = `${island.ix},${island.iz}`;
        let u = this.updrafts.get(key);
        if (!u) {
            u = updraftFor(island, this.templates.get(island), (x, z) => this.ground.height(x, z));
            this.updrafts.set(key, u);
        }
        return u;
    }
    updraftsNear(x0, z0, x1, z1) {
        const out = [];
        for (const island of islandsNear(this.seed, x0 - UPDRAFT_REACH, z0 - UPDRAFT_REACH, x1 + UPDRAFT_REACH, z1 + UPDRAFT_REACH)) {
            const u = this.updraftOf(island);
            if (u.x >= x0 && u.x <= x1 + 1 && u.z >= z0 && u.z <= z1 + 1)
                out.push(u);
        }
        return out;
    }
    generateChunk(cx, cy, cz) {
        if (cy < 0 || cy >= WORLD_CHUNKS_Y)
            return null;
        const col = this.columnBlock(cx, cz);
        const y0 = cy * CHUNK;
        const y1 = y0 + CHUNK - 1;
        const islands = col.islands.filter(({ island, template }) => island.baseY + template.minY <= y1 && island.baseY + template.maxY >= y0);
        if (y0 > col.maxY && !islands.length)
            return null;
        const data = new Uint8Array(CHUNK * CHUNK * CHUNK);
        let any = false;
        const x0 = cx * CHUNK;
        const z0 = cz * CHUNK;
        for (let lx = 0; lx < CHUNK; lx++) {
            for (let lz = 0; lz < CHUNK; lz++) {
                const h = col.h[(lx + BORDER) * COLS + lz + BORDER];
                const carve = y0 <= h - CAVE_ROOF;
                for (let ly = 0; ly < CHUNK; ly++) {
                    const id = groundBlock(y0 + ly, h);
                    if (id === AIR)
                        continue;
                    if (carve && id === BLOCK.stone && this.caves.open(x0 + lx, y0 + ly, z0 + lz, h))
                        continue;
                    data[localIndex(lx, ly, lz)] = id;
                    any = true;
                }
            }
        }
        if (!aboveAllVeins(y0)) {
            any = stampVeins(data, this.veins.near(x0, y0, z0, x0 + CHUNK - 1, y1, z0 + CHUNK - 1), x0, y0, z0) || any;
        }
        if (col.maxY >= y0)
            any = stampTrees(data, col, y0) || any;
        for (const { island, template } of islands) {
            any = stampIsland(data, template, x0 - island.x, y0 - island.baseY, z0 - island.z) || any;
        }
        return any ? data : null;
    }
    columnBlock(cx, cz) {
        const key = `${cx},${cz}`;
        const cached = this.columns.get(key);
        if (cached)
            return cached;
        const x0 = cx * CHUNK - BORDER;
        const z0 = cz * CHUNK - BORDER;
        const h = new Int16Array(COLS * COLS);
        let maxY = SEA_LEVEL;
        for (let i = 0; i < COLS; i++) {
            for (let j = 0; j < COLS; j++) {
                const v = this.ground.height(x0 + i, z0 + j);
                h[i * COLS + j] = v;
                if (v > maxY)
                    maxY = v;
            }
        }
        const heightAt = (x, z) => {
            const i = x - x0;
            const j = z - z0;
            return i >= 0 && i < COLS && j >= 0 && j < COLS ? h[i * COLS + j] : this.ground.height(x, z);
        };
        const tree = new Uint8Array(COLS * COLS);
        for (let i = CANOPY; i < COLS - CANOPY; i++) {
            for (let j = CANOPY; j < COLS - CANOPY; j++) {
                tree[i * COLS + j] = this.ground.treeHeight(x0 + i, z0 + j, heightAt);
            }
        }
        const block = {
            h, tree, maxY: maxY + TREE_MAX_HEIGHT + 2,
            islands: islandsNear(this.seed, cx * CHUNK, cz * CHUNK, cx * CHUNK + CHUNK - 1, cz * CHUNK + CHUNK - 1)
                .map(island => ({ island, template: this.templates.get(island) })),
        };
        if (this.columns.size >= COLUMN_CACHE)
            this.columns.delete(this.columns.keys().next().value);
        this.columns.set(key, block);
        return block;
    }
}
function groundBlock(y, h) {
    if (y === 0)
        return BLOCK.bedrock;
    if (y <= h - 4)
        return BLOCK.stone;
    if (y <= h - 1)
        return BLOCK.dirt;
    if (y === h)
        return GroundModel.surfaceFor(h);
    if (y <= SEA_LEVEL)
        return BLOCK.water;
    return AIR;
}
function stampTrees(data, col, y0) {
    let any = false;
    const put = (lx, y, lz, id, onlyAir) => {
        if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < y0 || y >= y0 + CHUNK)
            return;
        const i = localIndex(lx, y - y0, lz);
        if (onlyAir && data[i] !== AIR)
            return;
        data[i] = id;
        any = true;
    };
    const trees = [];
    for (let i = BORDER - CANOPY; i < COLS - BORDER + CANOPY; i++) {
        for (let j = BORDER - CANOPY; j < COLS - BORDER + CANOPY; j++) {
            const height = col.tree[i * COLS + j];
            if (height)
                trees.push({ lx: i - BORDER, lz: j - BORDER, base: col.h[i * COLS + j] + 1, height });
        }
    }
    for (const t of trees)
        for (let dy = 0; dy < t.height; dy++)
            put(t.lx, t.base + dy, t.lz, BLOCK.log, false);
    for (const t of trees) {
        const top = t.base + t.height;
        for (let dy = -2; dy < 2; dy++) {
            const r = dy < 0 ? 2 : 1;
            for (let dx = -r; dx <= r; dx++) {
                for (let dz = -r; dz <= r; dz++) {
                    if (Math.abs(dx) === r && Math.abs(dz) === r && dy !== -1)
                        continue;
                    put(t.lx + dx, top + dy, t.lz + dz, BLOCK.leaves, true);
                }
            }
        }
        put(t.lx, top + 2, t.lz, BLOCK.leaves, true);
    }
    return any;
}
function stampIsland(data, t, ox, oy, oz) {
    let any = false;
    const lx0 = Math.max(0, t.minX - ox);
    const lx1 = Math.min(CHUNK - 1, t.maxX - ox);
    const lz0 = Math.max(0, t.minZ - oz);
    const lz1 = Math.min(CHUNK - 1, t.maxZ - oz);
    const ly0 = Math.max(0, t.minY - oy);
    const ly1 = Math.min(CHUNK - 1, t.maxY - oy);
    for (let lx = lx0; lx <= lx1; lx++) {
        for (let lz = lz0; lz <= lz1; lz++) {
            for (let ly = ly0; ly <= ly1; ly++) {
                const id = t.get(ox + lx, oy + ly, oz + lz);
                if (id === AIR)
                    continue;
                data[localIndex(lx, ly, lz)] = id;
                any = true;
            }
        }
    }
    return any;
}
const generators = new Map();
function generatorFor(seed) {
    let g = generators.get(seed);
    if (!g) {
        g = new TerrainGenerator(seed);
        generators.set(seed, g);
    }
    return g;
}
export const generateChunk = (seed, cx, cy, cz) => generatorFor(seed).generateChunk(cx, cy, cz);
export const groundSpawn = (seed) => generatorFor(seed).spawn();
//# sourceMappingURL=terrainGen.js.map