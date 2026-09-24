import { isSolid } from "../world/palette.js";
const SETTLE_DEPTH = 24;
export const LOOT_REACH = 3.5;
const LOOT_ARC = Math.cos(Math.PI / 8);
export function settle(world, x, y, z) {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    let by = Math.floor(y);
    for (let i = 0; i < SETTLE_DEPTH; i++, by--) {
        if (isSolid(world.getBlock(bx, by - 1, bz)))
            return { x: bx + 0.5, y: by, z: bz + 0.5 };
    }
    return { x, y, z };
}
export class CrateManager {
    crates = [];
    world;
    nextId = 1;
    constructor(world) {
        this.world = world;
    }
    dropInventory(inv, x, y, z) {
        const items = [];
        inv.all().forEach((stack, i) => {
            if (!stack)
                return;
            items.push({ ...stack });
            inv.takeFromSlot(i, stack.count);
        });
        if (!items.length)
            return null;
        const p = settle(this.world, x, y, z);
        const crate = { id: this.nextId++, ...p, items, count: items.length };
        this.crates.push(crate);
        return crate;
    }
    restore(x, y, z, items) {
        const crate = { id: this.nextId++, x, y, z, items: items.map(s => ({ ...s })), count: items.length };
        this.crates.push(crate);
        return crate;
    }
    targeted(ex, ey, ez, dx, dy, dz) {
        let best = null;
        let bestD = LOOT_REACH;
        for (const c of this.crates) {
            const vx = c.x - ex;
            const vy = c.y + 0.5 - ey;
            const vz = c.z - ez;
            const d = Math.hypot(vx, vy, vz);
            if (d > bestD)
                continue;
            const cos = (vx * dx + vy * dy + vz * dz) / (d || 1);
            if (cos < LOOT_ARC)
                continue;
            best = c;
            bestD = d;
        }
        return best;
    }
    loot(crate, inv) {
        let taken = 0;
        crate.items = crate.items.flatMap(stack => {
            const left = inv.add(stack.id, stack.count);
            taken += stack.count - left;
            return left > 0 ? [{ id: stack.id, count: left }] : [];
        });
        crate.count = crate.items.length;
        if (!crate.items.length)
            this.remove(crate);
        return taken;
    }
    applySnapshot(list) {
        const seen = new Set();
        for (const s of list) {
            seen.add(s.id);
            let c = this.crates.find(x => x.id === s.id);
            if (!c) {
                c = { id: s.id, x: s.x, y: s.y, z: s.z, items: [], count: s.items };
                this.crates.push(c);
            }
            c.count = s.items;
        }
        for (const c of this.crates.slice())
            if (!seen.has(c.id))
                this.remove(c);
    }
    remove(crate) {
        const i = this.crates.indexOf(crate);
        if (i >= 0)
            this.crates.splice(i, 1);
    }
}
//# sourceMappingURL=crates.js.map