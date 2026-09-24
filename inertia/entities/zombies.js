import { BLOCK, isProp, isSolid } from "../world/palette.js";
import { isOre } from "../world/ores.js";
import { moveBox } from "../physics/aabb.js";
import { findPath, standingCellAt } from "./pathfinding.js";
export const ZOMBIE_STATS = {
    Basic: { hp: 30, speed: 2.0, damage: 4, blockDamage: 1, rifleResist: 1, poisons: false },
    Worker: { hp: 50, speed: 1.8, damage: 5, blockDamage: 3, rifleResist: 1, poisons: false },
    Soldier: { hp: 80, speed: 2.2, damage: 7, blockDamage: 1, rifleResist: 0.5, poisons: false },
    Toxic: { hp: 25, speed: 3.2, damage: 3, blockDamage: 1, rifleResist: 1, poisons: true },
};
export function blockHitPoints(id) {
    switch (id) {
        case BLOCK.dirt:
        case BLOCK.sand:
        case BLOCK.gravel:
        case BLOCK.leaves:
        case BLOCK.grass:
        case BLOCK.snow: return 3;
        case BLOCK.planks:
        case BLOCK.glass: return 5;
        case BLOCK.log: return 8;
        case BLOCK.cobble:
        case BLOCK.stone: return 15;
        case BLOCK.torch:
        case BLOCK.workbench:
        case BLOCK.bed: return 2;
        default: return isOre(id) ? 15 : undefined;
    }
}
export function kindsForNight(night) {
    const kinds = ['Basic'];
    if (night >= 2)
        kinds.push('Worker');
    if (night >= 3)
        kinds.push('Soldier');
    if (night >= 4)
        kinds.push('Toxic');
    return kinds;
}
export const zombiesForNight = (night, firstNight = 8, perNight = 6) => Math.max(0, firstNight + perNight * (night - 1));
export const ZOMBIE = {
    width: 0.6,
    height: 1.8,
    gravity: 25,
    jumpSpeed: 8,
    accel: 25,
    attackRange: 1.6,
    attackSeconds: 1.2,
    blockHitSeconds: 1.0,
    repathSeconds: 0.5,
    stuckSeconds: 0.5,
    maxLive: 40,
    minSpawnDistance: 20,
    burnSeconds: 10,
    deathSeconds: 1.2,
    pathBudgetMs: 1.5,
    pathMaxNodes: 500,
    pathMaxDistance: 40,
    spawnSearchHeight: 24,
};
export class ZombieManager {
    zombies = [];
    kills = 0;
    nextId = 1;
    host;
    rng;
    blockDamage = new Map();
    constructor(host, rng) {
        this.host = host;
        this.rng = rng;
    }
    get liveCount() {
        return this.zombies.filter(z => z.state === 'chase' || z.state === 'attack').length;
    }
    spawn(kind, x, y, z) {
        const zb = {
            id: this.nextId++, kind, x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0,
            hp: ZOMBIE_STATS[kind].hp, onGround: false, state: 'chase', burnTimer: 0,
            path: [], repathIn: this.rng.random() * ZOMBIE.repathSeconds, attackCooldown: 0.5, stuckTime: 0, attacked: false,
        };
        this.zombies.push(zb);
        return zb;
    }
    spawnGroup(kinds, count, targets, radius) {
        const world = this.host.world;
        let spawned = 0;
        if (!targets.length)
            return 0;
        for (let attempt = 0; attempt < 40 && spawned < count; attempt++) {
            if (this.liveCount >= ZOMBIE.maxLive)
                break;
            const around = targets[this.rng.randint(0, targets.length - 1)];
            const angle = this.rng.random() * Math.PI * 2;
            const dist = radius * (0.6 + this.rng.random() * 0.35);
            const x = Math.round(around.x + Math.cos(angle) * dist);
            const z = Math.round(around.z + Math.sin(angle) * dist);
            const y = this.grassTop(x, z, around.y);
            if (y === null)
                continue;
            if (targets.some(t => Math.hypot(t.x - x, t.z - z) < ZOMBIE.minSpawnDistance))
                continue;
            for (let i = 0; i < count && spawned < count; i++) {
                const sx = x + this.rng.randint(-2, 2);
                const sz = z + this.rng.randint(-2, 2);
                const sy = this.grassTop(sx, sz, y) ?? y;
                if (!isSolid(world.getBlock(sx, sy, sz)) && !isSolid(world.getBlock(sx, sy + 1, sz))) {
                    this.spawn(kinds[this.rng.randint(0, kinds.length - 1)], sx + 0.5, sy, sz + 0.5);
                    spawned++;
                }
            }
        }
        return spawned;
    }
    grassTop(x, z, nearY) {
        const world = this.host.world;
        if (!world.isColumnLoaded(x, z))
            return null;
        const centre = Math.floor(nearY);
        for (let d = 0; d <= ZOMBIE.spawnSearchHeight; d++) {
            for (const y of d ? [centre - d, centre + d] : [centre]) {
                const id = world.getBlock(x, y, z);
                if (id !== BLOCK.grass && id !== BLOCK.sand)
                    continue;
                if (isSolid(world.getBlock(x, y + 1, z)) || isSolid(world.getBlock(x, y + 2, z)))
                    continue;
                return y + 1;
            }
        }
        return null;
    }
    burnAll() {
        for (const z of this.zombies) {
            if (z.state === 'chase' || z.state === 'attack') {
                z.state = 'burn';
                z.burnTimer = ZOMBIE.burnSeconds;
            }
        }
    }
    damage(z, amount, knockX = 0, knockZ = 0) {
        if (z.state === 'dead' || z.state === 'burn')
            return false;
        z.hp -= amount;
        z.vx += knockX;
        z.vz += knockZ;
        if (knockX || knockZ)
            z.vy = Math.max(z.vy, 3);
        if (z.hp <= 0) {
            z.state = 'dead';
            z.burnTimer = ZOMBIE.deathSeconds;
            this.kills++;
            return true;
        }
        return false;
    }
    update(dt, targets) {
        const budgetEnd = performance.now() + ZOMBIE.pathBudgetMs;
        for (const z of this.zombies.slice()) {
            z.attacked = false;
            if (z.state === 'burn' || z.state === 'dead') {
                z.burnTimer -= dt;
                if (z.burnTimer <= 0)
                    this.zombies.splice(this.zombies.indexOf(z), 1);
                continue;
            }
            const target = this.nearest(z, targets);
            if (!target) {
                this.physics(z, dt, 0, 0);
                continue;
            }
            const dx = target.x - z.x;
            const dz = target.z - z.z;
            const horiz = Math.hypot(dx, dz);
            z.attackCooldown = Math.max(0, z.attackCooldown - dt);
            if (horiz <= ZOMBIE.attackRange && Math.abs(target.y - z.y) <= 1.6) {
                z.state = 'attack';
                z.yaw = Math.atan2(dx, dz);
                if (z.attackCooldown === 0) {
                    const st = ZOMBIE_STATS[z.kind];
                    this.host.damagePlayer(st.damage, st.poisons);
                    z.attackCooldown = ZOMBIE.attackSeconds;
                    z.attacked = true;
                }
                this.physics(z, dt, 0, 0);
                continue;
            }
            z.state = 'chase';
            z.repathIn -= dt;
            if (z.repathIn <= 0 && performance.now() < budgetEnd) {
                z.repathIn = ZOMBIE.repathSeconds;
                if (horiz > ZOMBIE.pathMaxDistance)
                    z.path = [];
                else {
                    const from = standingCellAt(this.host.world, z.x, z.y, z.z);
                    const to = standingCellAt(this.host.world, target.x, target.y, target.z);
                    z.path = findPath(this.host.world, from, to, ZOMBIE.pathMaxNodes).path;
                }
            }
            let wx = target.x;
            let wz = target.z;
            let wy = target.y;
            while (z.path.length) {
                const c = z.path[0];
                if (Math.hypot(c.x + 0.5 - z.x, c.z + 0.5 - z.z) < 0.4 && Math.abs(c.y - z.y) < 1.1) {
                    z.path.shift();
                    continue;
                }
                wx = c.x + 0.5;
                wz = c.z + 0.5;
                wy = c.y;
                break;
            }
            const mx = wx - z.x;
            const mz = wz - z.z;
            const ml = Math.hypot(mx, mz) || 1;
            z.yaw = Math.atan2(mx, mz);
            if (wy > z.y + 0.5 && z.onGround && ml < 1.4)
                z.vy = ZOMBIE.jumpSpeed;
            const speed = ZOMBIE_STATS[z.kind].speed;
            const blocked = this.physics(z, dt, (mx / ml) * speed, (mz / ml) * speed);
            if (blocked) {
                z.stuckTime += dt;
                if (z.stuckTime >= ZOMBIE.stuckSeconds)
                    this.attackBlockAhead(z, wy);
            }
            else {
                z.stuckTime = 0;
            }
        }
    }
    nearest(z, targets) {
        let best = null;
        let bestD = Infinity;
        for (const t of targets) {
            const d = Math.hypot(t.x - z.x, t.y - z.y, t.z - z.z);
            if (d < bestD) {
                bestD = d;
                best = t;
            }
        }
        return best;
    }
    physics(z, dt, wishX, wishZ) {
        const a = ZOMBIE.accel * dt;
        z.vx += Math.max(-a, Math.min(a, wishX - z.vx));
        z.vz += Math.max(-a, Math.min(a, wishZ - z.vz));
        z.vy = Math.max(-50, z.vy - ZOMBIE.gravity * dt);
        const half = ZOMBIE.width / 2;
        const box = { x: z.x - half, y: z.y, z: z.z - half, w: ZOMBIE.width, h: ZOMBIE.height, d: ZOMBIE.width };
        const r = moveBox(this.host.world, box, z.vx * dt, z.vy * dt, z.vz * dt);
        z.x = r.box.x + half;
        z.y = r.box.y;
        z.z = r.box.z + half;
        if (r.hitY) {
            z.onGround = z.vy <= 0;
            z.vy = 0;
        }
        else
            z.onGround = false;
        if (r.hitX)
            z.vx = 0;
        if (r.hitZ)
            z.vz = 0;
        if (z.y < -8) {
            z.state = 'dead';
            z.burnTimer = 0;
        }
        return (r.hitX || r.hitZ) && (wishX !== 0 || wishZ !== 0);
    }
    attackBlockAhead(z, waypointY) {
        if (z.attackCooldown > 0)
            return;
        const fx = Math.floor(z.x + Math.sin(z.yaw) * 0.7);
        const fz = Math.floor(z.z + Math.cos(z.yaw) * 0.7);
        const fy = Math.floor(z.y);
        const candidates = [
            { x: fx, y: fy + 1, z: fz }, { x: fx, y: fy, z: fz },
            { x: fx, y: fy + 2, z: fz }, { x: Math.floor(z.x), y: fy + 2, z: Math.floor(z.z) },
        ];
        if (waypointY > z.y + 1.5)
            candidates.push({ x: Math.floor(z.x), y: fy + 2, z: Math.floor(z.z) });
        for (const c of candidates) {
            const id = this.host.world.getBlock(c.x, c.y, c.z);
            const hp = blockHitPoints(id);
            if (hp === undefined || !isSolid(id) && !isProp(id))
                continue;
            const k = `${c.x},${c.y},${c.z}`;
            const dmg = (this.blockDamage.get(k) ?? 0) + ZOMBIE_STATS[z.kind].blockDamage;
            z.attackCooldown = ZOMBIE.blockHitSeconds;
            z.attacked = true;
            if (dmg >= hp) {
                this.blockDamage.delete(k);
                this.host.breakBlock(c.x, c.y, c.z);
            }
            else {
                this.blockDamage.set(k, dmg);
            }
            return;
        }
    }
    blockHits(x, y, z) {
        return this.blockDamage.get(`${x},${y},${z}`) ?? 0;
    }
}
//# sourceMappingURL=zombies.js.map