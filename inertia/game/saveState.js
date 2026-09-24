export const MAX_SAVED_DROPS = 500;
export function savedPlayerOf(a) {
    return {
        name: a.name,
        inventory: a.inventory.all().map(s => (s ? { ...s } : null)),
        spawn: { ...a.spawn },
        pos: { x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: a.pitch },
        health: a.health,
        magazine: a.magazine,
        kills: a.kills,
        deaths: a.deaths,
    };
}
export function collectSave(o) {
    const players = {};
    for (const [id, p] of o.departed)
        players[id] = p;
    for (const { userId, avatar } of o.live)
        players[userId] = savedPlayerOf(avatar);
    const drops = [...o.drops].map(d => ({ id: d.item, count: d.count, x: d.x, y: d.y, z: d.z }));
    return {
        version: 3,
        seed: o.seed,
        time: o.time,
        edits: o.edits,
        players,
        zombies: [...o.zombies]
            .filter(z => z.state === 'chase' || z.state === 'attack')
            .map(z => ({ kind: z.kind, x: z.x, y: z.y, z: z.z, hp: z.hp })),
        drops: drops.slice(Math.max(0, drops.length - MAX_SAVED_DROPS)),
        crates: [...o.crates].map(c => ({ x: c.x, y: c.y, z: c.z, items: c.items.map(s => ({ ...s })) })),
        savedAt: o.now ?? Date.now(),
    };
}
export function restorePlayer(a, p, pose) {
    a.inventory.replace(p.inventory);
    a.spawn = { ...p.spawn };
    a.kills = p.kills;
    a.deaths = p.deaths;
    a.magazine = p.magazine;
    if (!pose)
        return;
    a.x = p.pos.x;
    a.y = p.pos.y;
    a.z = p.pos.z;
    a.yaw = p.pos.yaw;
    a.pitch = p.pos.pitch;
    a.health = p.health;
}
export function zombiesToRestore(save, phaseAt) {
    return phaseAt(save.time) === 'night' ? save.zombies : [];
}
export function visitorsOf(save, hostUserId) {
    const out = new Map();
    for (const [id, p] of Object.entries(save.players))
        if (id !== hostUserId)
            out.set(id, p);
    return out;
}
//# sourceMappingURL=saveState.js.map