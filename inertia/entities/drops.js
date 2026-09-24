import { moveBox } from "../physics/aabb.js";
export const DROP_SIZE = 0.3;
const GRAVITY = 18;
const PICKUP_RADIUS = 1.2;
const PICKUP_BELOW = 1.6;
const PICKUP_ABOVE = 2.0;
const PICKUP_DELAY = 0.6;
const MAX_DROPS = 200;
export function canPickUp(d, px, py, pz) {
    return Math.hypot(d.x - px, d.z - pz) < PICKUP_RADIUS && d.y > py - PICKUP_BELOW && d.y < py + PICKUP_ABOVE;
}
export class DropManager {
    drops = [];
    world;
    nextId = 1;
    constructor(world) {
        this.world = world;
    }
    spawn(item, count, x, y, z, vx = 0, vy = 2, vz = 0) {
        const drop = { id: this.nextId++, item, count, x, y, z, vx, vy, vz, age: 0 };
        this.drops.push(drop);
        if (this.drops.length > MAX_DROPS)
            this.remove(this.drops[0]);
        return drop;
    }
    update(dt, collectors) {
        for (const d of this.drops.slice()) {
            d.age += dt;
            d.vy -= GRAVITY * dt;
            d.vx *= 0.9;
            d.vz *= 0.9;
            const box = { x: d.x - DROP_SIZE / 2, y: d.y, z: d.z - DROP_SIZE / 2, w: DROP_SIZE, h: DROP_SIZE, d: DROP_SIZE };
            const r = moveBox(this.world, box, d.vx * dt, d.vy * dt, d.vz * dt);
            d.x = r.box.x + DROP_SIZE / 2;
            d.y = r.box.y;
            d.z = r.box.z + DROP_SIZE / 2;
            if (r.hitY)
                d.vy = 0;
            if (d.y < -60) {
                this.remove(d);
                continue;
            }
            if (d.age > PICKUP_DELAY) {
                for (const c of collectors) {
                    if (!canPickUp(d, c.x, c.y, c.z))
                        continue;
                    const left = c.inv.add(d.item, d.count);
                    if (left === 0) {
                        this.remove(d);
                        break;
                    }
                    d.count = left;
                }
            }
        }
    }
    applySnapshot(list) {
        const seen = new Set();
        for (const s of list) {
            seen.add(s.id);
            let d = this.drops.find(x => x.id === s.id);
            if (!d) {
                d = { id: s.id, item: s.item, count: 1, x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, age: 1 };
                this.drops.push(d);
            }
            d.x = s.x;
            d.y = s.y;
            d.z = s.z;
        }
        for (const d of this.drops.slice())
            if (!seen.has(d.id))
                this.remove(d);
    }
    remove(d) {
        const i = this.drops.indexOf(d);
        if (i >= 0)
            this.drops.splice(i, 1);
    }
}
//# sourceMappingURL=drops.js.map