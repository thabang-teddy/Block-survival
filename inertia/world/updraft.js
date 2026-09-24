import { AIR, BLOCK } from "./palette.js";
export const UPDRAFT = {
    radius: 1.25,
    gap: 2,
    aboveRim: 3,
    rise: 6,
    sink: 4,
    accel: 40,
};
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const STRIP_DEPTH = UPDRAFT.gap + 2;
const STRIP_HALF_WIDTH = 1;
function columnIsClear(t, x, z) {
    for (let y = t.minY; y <= t.maxY; y++)
        if (t.get(x, y, z) !== AIR)
            return false;
    return true;
}
function rimTop(t, x, z) {
    for (let y = t.maxY; y >= t.minY; y--) {
        const id = t.get(x, y, z);
        if (id !== AIR && id !== BLOCK.log && id !== BLOCK.leaves)
            return y;
    }
    return null;
}
export function updraftFor(island, t, groundHeight) {
    const extent = Math.max(-t.minX, t.maxX, -t.minZ, t.maxZ) + 1;
    for (const [ux, uz] of DIRECTIONS) {
        const px = -uz;
        const pz = ux;
        let rim = null;
        for (let d = 0; d <= extent; d++) {
            const top = rimTop(t, d * ux, d * uz);
            if (top !== null)
                rim = top;
            if (d === 0 || rim === null)
                continue;
            let clear = true;
            for (let k = 0; k < STRIP_DEPTH && clear; k++) {
                for (let m = -STRIP_HALF_WIDTH; m <= STRIP_HALF_WIDTH; m++) {
                    if (!columnIsClear(t, (d + k) * ux + m * px, (d + k) * uz + m * pz)) {
                        clear = false;
                        break;
                    }
                }
            }
            if (!clear)
                continue;
            const bx = island.x + (d + UPDRAFT.gap) * ux;
            const bz = island.z + (d + UPDRAFT.gap) * uz;
            return {
                x: bx + 0.5,
                z: bz + 0.5,
                bottomY: groundHeight(bx, bz) + 1,
                topY: island.baseY + rim + UPDRAFT.aboveRim,
                radius: UPDRAFT.radius,
                ix: island.ix,
                iz: island.iz,
            };
        }
    }
    throw new Error(`no clear rim for island ${island.ix},${island.iz}`);
}
export function updraftAt(shafts, x, y, z) {
    for (const u of shafts) {
        if (y < u.bottomY || y > u.topY)
            continue;
        const dx = x - u.x;
        const dz = z - u.z;
        if (dx * dx + dz * dz <= u.radius * u.radius)
            return u;
    }
    return null;
}
//# sourceMappingURL=updraft.js.map