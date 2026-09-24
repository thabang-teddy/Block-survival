import { HOTBAR_SIZE, INVENTORY_SIZE } from "../items/inventory.js";
import { RECIPES } from "../items/recipes.js";
const MAX_COORD = 1_000_000;
const MAX_NAME = 16;
const MAX_CHAT = 200;
const ANIMS = ['Idle', 'Walk', 'Run', 'Aim', 'Swing'];
const RECIPE_IDS = new Set(RECIPES.map(r => r.id));
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_COORD;
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const unit = (v) => num(v) && Math.abs(v) <= 1.0001;
const cell = (m) => int(m.x, -MAX_COORD, MAX_COORD) && int(m.y, -MAX_COORD, MAX_COORD) && int(m.z, -MAX_COORD, MAX_COORD);
const ray = (m) => num(m.ox) && num(m.oy) && num(m.oz) && unit(m.dx) && unit(m.dy) && unit(m.dz);
export function validateClientMessage(raw) {
    if (!isObj(raw) || typeof raw.t !== 'string')
        return null;
    const m = raw;
    switch (m.t) {
        case 'hello':
            if (!int(m.v, 0, 1_000_000) || typeof m.name !== 'string')
                return null;
            return { t: 'hello', v: m.v, name: m.name.slice(0, MAX_NAME) };
        case 'input':
            if (!num(m.x) || !num(m.y) || !num(m.z) || !num(m.yaw) || !num(m.pitch))
                return null;
            if (!ANIMS.includes(m.anim) || !int(m.slot, 0, HOTBAR_SIZE - 1) || typeof m.aiming !== 'boolean')
                return null;
            return { t: 'input', x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, anim: m.anim, slot: m.slot, aiming: m.aiming };
        case 'break':
            return cell(m) ? { t: 'break', x: m.x, y: m.y, z: m.z } : null;
        case 'place':
            if (!cell(m) || !int(m.nx, -1, 1) || !int(m.ny, -1, 1) || !int(m.nz, -1, 1) || !int(m.slot, 0, HOTBAR_SIZE - 1) || !num(m.yaw))
                return null;
            return { t: 'place', x: m.x, y: m.y, z: m.z, nx: m.nx, ny: m.ny, nz: m.nz, slot: m.slot, yaw: m.yaw };
        case 'craft':
            return typeof m.recipe === 'string' && RECIPE_IDS.has(m.recipe) ? { t: 'craft', recipe: m.recipe } : null;
        case 'moveSlot':
            return int(m.from, 0, INVENTORY_SIZE - 1) && int(m.to, 0, INVENTORY_SIZE - 1) ? { t: 'moveSlot', from: m.from, to: m.to } : null;
        case 'dropHeld':
            return int(m.slot, 0, INVENTORY_SIZE - 1) && unit(m.dx) && unit(m.dz) ? { t: 'dropHeld', slot: m.slot, dx: m.dx, dz: m.dz } : null;
        case 'interact':
            if (!cell(m) || !int(m.block, 0, 65535))
                return null;
            if (m.crate !== null && !int(m.crate, 0, Number.MAX_SAFE_INTEGER))
                return null;
            return { t: 'interact', x: m.x, y: m.y, z: m.z, block: m.block, crate: m.crate };
        case 'swing':
        case 'fire':
            if (!ray(m))
                return null;
            return { t: m.t, ox: m.ox, oy: m.oy, oz: m.oz, dx: m.dx, dy: m.dy, dz: m.dz };
        case 'reload':
            return { t: 'reload' };
        case 'save':
            return { t: 'save' };
        case 'chat':
            return typeof m.text === 'string' ? { t: 'chat', text: m.text.slice(0, MAX_CHAT) } : null;
        default:
            return null;
    }
}
//# sourceMappingURL=validate.js.map