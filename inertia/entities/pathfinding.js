import { isSolid } from "../world/palette.js";
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const STEPS = [0, 1, -1, -2, -3];
const relKey = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
export function isStanding(world, x, y, z) {
    return !isSolid(world.getBlock(x, y, z)) && !isSolid(world.getBlock(x, y + 1, z)) && isSolid(world.getBlock(x, y - 1, z));
}
export function standingCellAt(world, px, py, pz) {
    const x = Math.floor(px);
    const z = Math.floor(pz);
    let y = Math.floor(py + 0.01);
    for (let i = 0; i < 4; i++) {
        if (isStanding(world, x, y, z))
            return { x, y, z };
        y--;
    }
    return { x, y: Math.floor(py), z };
}
class Heap {
    a = [];
    get size() { return this.a.length; }
    push(n) {
        const a = this.a;
        a.push(n);
        let i = a.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (a[p].f <= a[i].f)
                break;
            const t = a[p];
            a[p] = a[i];
            a[i] = t;
            i = p;
        }
    }
    pop() {
        const a = this.a;
        const top = a[0];
        const last = a.pop();
        if (a.length) {
            a[0] = last;
            let i = 0;
            for (;;) {
                const l = i * 2 + 1;
                const r = l + 1;
                let m = i;
                if (l < a.length && a[l].f < a[m].f)
                    m = l;
                if (r < a.length && a[r].f < a[m].f)
                    m = r;
                if (m === i)
                    break;
                const t = a[m];
                a[m] = a[i];
                a[i] = t;
                i = m;
            }
        }
        return top;
    }
}
export function findPath(world, start, goal, maxNodes = 800) {
    const h = (x, y, z) => Math.abs(x - goal.x) + Math.abs(z - goal.z) + Math.abs(y - goal.y) * 0.5;
    const key = (x, y, z) => relKey(x - start.x, y - start.y, z - start.z);
    const open = new Heap();
    const best = new Map();
    const startNode = { ...start, g: 0, f: h(start.x, start.y, start.z), parent: null };
    open.push(startNode);
    best.set(key(start.x, start.y, start.z), 0);
    let closest = startNode;
    let closestH = startNode.f;
    let expanded = 0;
    while (open.size && expanded < maxNodes) {
        const n = open.pop();
        expanded++;
        const hn = h(n.x, n.y, n.z);
        if (hn < closestH) {
            closest = n;
            closestH = hn;
        }
        if (Math.abs(n.x - goal.x) + Math.abs(n.z - goal.z) <= 1 && Math.abs(n.y - goal.y) <= 1) {
            return { path: unwind(n), reached: true };
        }
        for (const [dx, dz] of DIRS) {
            const nx = n.x + dx;
            const nz = n.z + dz;
            for (const dy of STEPS) {
                const ny = n.y + dy;
                if (!isStanding(world, nx, ny, nz))
                    continue;
                if (dy === 1 && isSolid(world.getBlock(n.x, n.y + 2, n.z)))
                    break;
                const g = n.g + 1 + (dy === 1 ? 0.5 : dy < 0 ? 0.2 * -dy : 0);
                const k = key(nx, ny, nz);
                const prev = best.get(k);
                if (prev !== undefined && prev <= g)
                    break;
                best.set(k, g);
                open.push({ x: nx, y: ny, z: nz, g, f: g + h(nx, ny, nz), parent: n });
                break;
            }
        }
    }
    return { path: unwind(closest), reached: false };
}
function unwind(n) {
    const out = [];
    for (let c = n; c && c.parent; c = c.parent)
        out.push({ x: c.x, y: c.y, z: c.z });
    return out.reverse();
}
//# sourceMappingURL=pathfinding.js.map