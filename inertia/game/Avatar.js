import { Inventory } from "../items/inventory.js";
export const AVATAR = {
    maxHealth: 100,
    healthRegen: 1,
    healthRegenDelay: 8,
    eyeHeight: 1.62,
};
export class Avatar {
    id;
    name;
    userId = null;
    x = 0;
    y = 0;
    z = 0;
    yaw = 0;
    pitch = 0;
    anim = 'Idle';
    slot = 0;
    aiming = false;
    inventory = new Inventory();
    magazine = 0;
    reloadUntil = 0;
    pendingRounds = 0;
    nextShotAt = 0;
    health = AVATAR.maxHealth;
    sinceDamage = 99;
    poisonUntil = 0;
    hurtAt = -10;
    dead = false;
    respawnAt = 0;
    spawn;
    kills = 0;
    deaths = 0;
    outbox = { t: 'state' };
    inventoryVersionSent = -1;
    constructor(id, name, spawn) {
        this.id = id;
        this.name = name;
        this.spawn = { ...spawn };
        this.x = spawn.x;
        this.y = spawn.y;
        this.z = spawn.z;
    }
    get heldItem() {
        return this.inventory.get(this.slot)?.id ?? null;
    }
    get alive() {
        return !this.dead;
    }
    eye() {
        return { x: this.x, y: this.y + AVATAR.eyeHeight, z: this.z };
    }
    damage(amount) {
        this.health = Math.max(0, this.health - amount);
        this.sinceDamage = 0;
    }
    tickHealth(dt) {
        this.sinceDamage += dt;
        if (this.sinceDamage > AVATAR.healthRegenDelay && !this.dead) {
            this.health = Math.min(AVATAR.maxHealth, this.health + AVATAR.healthRegen * dt);
        }
    }
    push(patch) {
        if (patch.fx)
            this.outbox.fx = [...(this.outbox.fx ?? []), ...patch.fx];
        const { fx: _fx, ...rest } = patch;
        Object.assign(this.outbox, rest);
    }
    takeOutbox() {
        const out = this.outbox;
        const changed = Object.keys(out).length > 1;
        this.outbox = { t: 'state' };
        return changed ? out : null;
    }
}
//# sourceMappingURL=Avatar.js.map