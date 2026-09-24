import { BLOCK } from "./palette.js";
import { fractal2, makeRng, PerlinNoise } from "./noise.js";
export const ISLAND_LARGE = {
    size: 56, seed: 11, maxHeight: 9, depth: 16, padRadius: 8, lake: true, treeDensity: 0.022,
};
export const ISLAND_MEDIUM = {
    size: 32, seed: 7, maxHeight: 6, depth: 11, padRadius: 5, lake: true, treeDensity: 0.022,
};
const colKey = (x, z) => (x + 512) * 1024 + (z + 512);
function addTree(world, x, y, z, rng) {
    const height = rng.randint(4, 6);
    for (let dy = 0; dy < height; dy++)
        world.setBlock(x, y + dy, z, BLOCK.log);
    const top = y + height;
    for (let dy = -2; dy < 2; dy++) {
        const r = dy < 0 ? 2 : 1;
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (Math.abs(dx) === r && Math.abs(dz) === r && dy !== -1)
                    continue;
                world.setBlockIfAir(x + dx, top + dy, z + dz, BLOCK.leaves);
            }
        }
    }
    world.setBlock(x, top + 2, z, BLOCK.leaves);
}
export function generateIsland(world, p) {
    const { size, seed, maxHeight, depth, padRadius, lake, treeDensity } = p;
    const rng = makeRng(seed);
    const n2 = fractal2(new PerlinNoise(seed));
    const R = size / 2;
    const Ri = Math.trunc(R);
    const heights = new Map();
    for (let x = -Ri - 1; x <= Ri + 1; x++) {
        for (let z = -Ri - 1; z <= Ri + 1; z++) {
            const d = Math.hypot(x, z) / R;
            const mask = 1 - d + 0.3 * n2(x, z, seed, 0.09);
            if (mask <= 0.12)
                continue;
            let h = mask * maxHeight + 2 * n2(x, z, seed + 1, 0.16);
            h = mask > 0.5 ? Math.round(h / 2) * 2 : Math.round(h);
            h = Math.max(0, Math.min(maxHeight + 2, h));
            let dep = Math.trunc(mask * depth + 2 * n2(x, z, seed + 2, 0.13) * mask);
            dep = Math.max(1, dep);
            heights.set(colKey(x, z), { x, z, h, dep });
        }
    }
    let padHeight = 2;
    if (padRadius) {
        const ring = [];
        for (const { x, z, h } of heights.values()) {
            const dist = Math.hypot(x, z);
            if (dist > padRadius && dist <= padRadius + 3)
                ring.push(h);
        }
        if (ring.length) {
            ring.sort((a, b) => a - b);
            padHeight = Math.round(ring[ring.length >> 1] / 2) * 2;
        }
        for (const col of heights.values()) {
            if (Math.hypot(col.x, col.z) <= padRadius)
                col.h = padHeight;
        }
    }
    const lakeCells = new Set();
    let lakeLevel = 0;
    if (lake) {
        const lr = Math.max(2, Math.trunc(size / 9));
        const minLakeDist = padRadius + lr + 3;
        const maxLakeDist = Math.max(minLakeDist, R * 0.7);
        const angle = rng.random() * Math.PI * 2;
        const dist = minLakeDist + rng.random() * (maxLakeDist - minLakeDist);
        const lx = Math.round(Math.cos(angle) * dist);
        const lz = Math.round(Math.sin(angle) * dist);
        for (const { x, z } of heights.values()) {
            if (Math.hypot(x - lx, z - lz) <= lr + 0.6 * n2(x, z, seed + 3, 0.3))
                lakeCells.add(colKey(x, z));
        }
        if (lakeCells.size) {
            lakeLevel = Infinity;
            for (const k of lakeCells)
                lakeLevel = Math.min(lakeLevel, heights.get(k).h);
        }
    }
    let voxelCount = 0;
    for (const { x, z, h, dep } of heights.values()) {
        if (lakeCells.has(colKey(x, z))) {
            const floor = lakeLevel - 2;
            for (let y = -dep; y < floor; y++) {
                world.setBlock(x, y, z, BLOCK.stone);
                voxelCount++;
            }
            world.setBlock(x, floor, z, BLOCK.sand);
            voxelCount++;
            for (let y = floor + 1; y <= lakeLevel; y++) {
                world.setBlock(x, y, z, BLOCK.water);
                voxelCount++;
            }
            continue;
        }
        let nearLake = false;
        for (let dx = -1; dx <= 1 && !nearLake; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (lakeCells.has(colKey(x + dx, z + dz))) {
                    nearLake = true;
                    break;
                }
            }
        }
        for (let y = -dep; y <= h; y++) {
            let kind;
            if (y === h) {
                kind = nearLake && h <= lakeLevel + 1 ? BLOCK.sand : BLOCK.grass;
            }
            else if (y >= h - 2) {
                kind = BLOCK.dirt;
            }
            else {
                kind = BLOCK.stone;
                const r = rng.random();
                if (r < 0.03)
                    kind = BLOCK.ore_coal;
                else if (r < 0.045)
                    kind = BLOCK.ore_iron;
                else if (r < 0.055)
                    kind = BLOCK.ore_copper;
            }
            world.setBlock(x, y, z, kind);
            voxelCount++;
        }
        if (h >= maxHeight + 1 && size >= 40)
            world.setBlock(x, h, z, BLOCK.snow);
    }
    const grassCells = [];
    for (const { x, z, h } of heights.values()) {
        if (lakeCells.has(colKey(x, z)))
            continue;
        if (world.getBlock(x, h, z) !== BLOCK.grass)
            continue;
        const dist = Math.hypot(x, z);
        if (dist > padRadius + 3 && dist < R * 0.85)
            grassCells.push({ x, y: h, z });
    }
    const shuffled = rng.shuffle(grassCells);
    const placed = [];
    const target = Math.trunc(grassCells.length * treeDensity);
    for (const { x, y, z } of shuffled) {
        if (placed.length >= target)
            break;
        if (placed.every(p => Math.abs(x - p.x) > 3 || Math.abs(z - p.z) > 3)) {
            addTree(world, x, y + 1, z, rng);
            placed.push({ x, z });
        }
    }
    return { spawn: { x: 0.5, y: padHeight + 1, z: 0.5 }, padHeight, voxelCount };
}
//# sourceMappingURL=islandGen.js.map