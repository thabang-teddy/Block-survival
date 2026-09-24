import { ISLAND_LARGE } from "../world/islandGen.js";
import { LEGACY_ISLAND_Y } from "../world/islandField.js";
import { groundSpawn } from "../world/terrainGen.js";
import { AVATAR } from "../game/Avatar.js";
const V1_SEED = ISLAND_LARGE.seed;
const isRecord = (v) => typeof v === 'object' && v !== null;
function liftEdit(e, dy) {
    const meta = e.meta
        ? { ...e.meta, y: e.meta.y + dy, ...(e.meta.partner ? { partner: { ...e.meta.partner, y: e.meta.partner.y + dy } } : {}) }
        : undefined;
    return { ...e, y: e.y + dy, ...(meta ? { meta } : {}) };
}
export function migrateV1(save) {
    const seed = V1_SEED;
    return {
        version: 2,
        seed,
        time: save.time,
        edits: save.edits.map(e => liftEdit(e, LEGACY_ISLAND_Y)),
        inventory: save.inventory,
        spawn: groundSpawn(seed),
        kills: save.kills,
        deaths: save.deaths,
    };
}
export function migrateV2(save, userId, name = 'Player') {
    const host = {
        name,
        inventory: save.inventory,
        spawn: save.spawn,
        pos: { ...save.spawn, yaw: 0, pitch: 0 },
        health: AVATAR.maxHealth,
        magazine: 0,
        kills: save.kills,
        deaths: save.deaths,
    };
    return {
        version: 3,
        seed: save.seed,
        time: save.time,
        edits: save.edits,
        players: { [String(userId)]: host },
        zombies: [],
        drops: [],
        crates: [],
        savedAt: 0,
    };
}
export function migrateSave(raw, userId) {
    if (!isRecord(raw) || !Array.isArray(raw.edits))
        return null;
    if (raw.version === 3)
        return typeof raw.seed === 'number' && isRecord(raw.players) ? raw : null;
    if (raw.version === 2)
        return typeof raw.seed === 'number' ? migrateV2(raw, userId) : null;
    if (raw.version === 1)
        return migrateV2(migrateV1(raw), userId);
    return null;
}
//# sourceMappingURL=saveMigrate.js.map