import { AIR } from "./palette.js";
export const CHUNK = 16;
const SHIFT = 4;
const MASK = CHUNK - 1;
const KEY_HALF = 1 << 20;
const KEY_SPAN = KEY_HALF * 2;
const KEY_Y_HALF = 512;
const KEY_Y_SPAN = KEY_Y_HALF * 2;
export const chunkKey = (cx, cy, cz) => `${cx},${cy},${cz}`;
export const numKey = (cx, cy, cz) => ((cx + KEY_HALF) * KEY_SPAN + (cz + KEY_HALF)) * KEY_Y_SPAN + (cy + KEY_Y_HALF);
export const columnKey = (cx, cz) => (cx + KEY_HALF) * KEY_SPAN + (cz + KEY_HALF);
export const columnFromKey = (key) => ({
    cx: Math.floor(key / KEY_SPAN) - KEY_HALF,
    cz: (key % KEY_SPAN) - KEY_HALF,
});
export const toChunkCoord = (x, y, z) => ({
    cx: x >> SHIFT,
    cy: y >> SHIFT,
    cz: z >> SHIFT,
});
export const localIndex = (x, y, z) => ((x & MASK) << 8) | ((y & MASK) << 4) | (z & MASK);
export const blockKey = (x, y, z) => `${x},${y},${z}`;
export class World {
    chunks = new Map();
    chunksByNum = new Map();
    lastKey = NaN;
    lastChunk;
    dirty = new Set();
    removed = [];
    generator = null;
    chunksY = 0;
    loadedColumns = new Set();
    props = new Map();
    propsVersion = 0;
    trackEdits = false;
    edits = new Map();
    editsByChunk = new Map();
    setGenerator(generator, chunksY) {
        this.generator = generator;
        this.chunksY = chunksY;
    }
    get isStreamed() {
        return this.generator !== null;
    }
    getChunk(cx, cy, cz) {
        return this.chunks.get(chunkKey(cx, cy, cz));
    }
    chunkKeys() {
        return this.chunks.keys();
    }
    get chunkCount() {
        return this.chunks.size;
    }
    get loadedColumnCount() {
        return this.loadedColumns.size;
    }
    isColumnLoaded(x, z) {
        return !this.generator || this.loadedColumns.has(columnKey(x >> SHIFT, z >> SHIFT));
    }
    isChunkColumnLoaded(cx, cz) {
        return !this.generator || this.loadedColumns.has(columnKey(cx, cz));
    }
    getBlock(x, y, z) {
        const k = numKey(x >> SHIFT, y >> SHIFT, z >> SHIFT);
        let c;
        if (k === this.lastKey)
            c = this.lastChunk;
        else {
            c = this.chunksByNum.get(k);
            this.lastKey = k;
            this.lastChunk = c;
        }
        return c ? c[localIndex(x, y, z)] : AIR;
    }
    hasBlock(x, y, z) {
        return this.getBlock(x, y, z) !== AIR;
    }
    setBlock(x, y, z, id) {
        const cx = x >> SHIFT;
        const cy = y >> SHIFT;
        const cz = z >> SHIFT;
        const key = chunkKey(cx, cy, cz);
        const pk = blockKey(x, y, z);
        let c = this.chunks.get(key);
        if (!c) {
            if (this.generator && !this.loadedColumns.has(columnKey(cx, cz))) {
                if (this.props.delete(pk))
                    this.propsVersion++;
                this.recordEdit(key, pk, x, y, z, id);
                return;
            }
            if (id === AIR)
                return;
            c = this.allocate(cx, cy, cz, key);
        }
        const i = localIndex(x, y, z);
        if (c[i] === id)
            return;
        c[i] = id;
        if (this.props.delete(pk))
            this.propsVersion++;
        this.recordEdit(key, pk, x, y, z, id);
        this.dirty.add(key);
        this.markNeighbourChunks(x, y, z, cx, cy, cz);
    }
    setProp(meta) {
        this.setBlock(meta.x, meta.y, meta.z, meta.id);
        this.props.set(blockKey(meta.x, meta.y, meta.z), meta);
        this.propsVersion++;
    }
    getProp(x, y, z) {
        return this.props.get(blockKey(x, y, z));
    }
    setBlockIfAir(x, y, z, id) {
        if (this.getBlock(x, y, z) === AIR)
            this.setBlock(x, y, z, id);
    }
    editsInChunk(cx, cy, cz) {
        return this.editsByChunk.get(chunkKey(cx, cy, cz))?.values() ?? [];
    }
    loadColumn(cx, cz) {
        const gen = this.generator;
        if (!gen)
            throw new Error('World.loadColumn needs a generator');
        const col = columnKey(cx, cz);
        if (this.loadedColumns.has(col))
            return;
        this.loadedColumns.add(col);
        for (let cy = 0; cy < this.chunksY; cy++) {
            const key = chunkKey(cx, cy, cz);
            let data = gen(cx, cy, cz);
            const edits = this.editsByChunk.get(key);
            if (edits) {
                for (const e of edits.values()) {
                    if (!data) {
                        if (e.id === AIR)
                            continue;
                        data = new Uint8Array(CHUNK * CHUNK * CHUNK);
                    }
                    data[localIndex(e.x, e.y, e.z)] = e.id;
                }
            }
            if (!data)
                continue;
            this.chunks.set(key, data);
            this.chunksByNum.set(numKey(cx, cy, cz), data);
            this.dirty.add(key);
        }
        this.lastKey = NaN;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            for (let cy = 0; cy < this.chunksY; cy++)
                this.dirtyIfExists(cx + dx, cy, cz + dz);
        }
    }
    unloadColumn(cx, cz) {
        const col = columnKey(cx, cz);
        if (!this.loadedColumns.delete(col))
            return;
        for (let cy = 0; cy < this.chunksY; cy++) {
            const key = chunkKey(cx, cy, cz);
            if (!this.chunks.delete(key))
                continue;
            this.chunksByNum.delete(numKey(cx, cy, cz));
            this.dirty.delete(key);
            this.removed.push(key);
        }
        this.lastKey = NaN;
    }
    takeRemoved() {
        const out = this.removed;
        this.removed = [];
        return out;
    }
    takeDirty() {
        const out = Array.from(this.dirty);
        this.dirty.clear();
        return out;
    }
    markAllDirty() {
        for (const k of this.chunks.keys())
            this.dirty.add(k);
    }
    allocate(cx, cy, cz, key) {
        const c = new Uint8Array(CHUNK * CHUNK * CHUNK);
        this.chunks.set(key, c);
        this.chunksByNum.set(numKey(cx, cy, cz), c);
        this.lastKey = NaN;
        return c;
    }
    recordEdit(chunk, pk, x, y, z, id) {
        if (!this.trackEdits)
            return;
        const e = { x, y, z, id };
        this.edits.set(pk, e);
        let perChunk = this.editsByChunk.get(chunk);
        if (!perChunk) {
            perChunk = new Map();
            this.editsByChunk.set(chunk, perChunk);
        }
        perChunk.set(pk, e);
    }
    markNeighbourChunks(x, y, z, cx, cy, cz) {
        const lx = x & MASK;
        const ly = y & MASK;
        const lz = z & MASK;
        if (lx === 0)
            this.dirtyIfExists(cx - 1, cy, cz);
        if (lx === MASK)
            this.dirtyIfExists(cx + 1, cy, cz);
        if (ly === 0)
            this.dirtyIfExists(cx, cy - 1, cz);
        if (ly === MASK)
            this.dirtyIfExists(cx, cy + 1, cz);
        if (lz === 0)
            this.dirtyIfExists(cx, cy, cz - 1);
        if (lz === MASK)
            this.dirtyIfExists(cx, cy, cz + 1);
    }
    dirtyIfExists(cx, cy, cz) {
        const k = chunkKey(cx, cy, cz);
        if (this.chunks.has(k))
            this.dirty.add(k);
    }
}
//# sourceMappingURL=chunkStore.js.map