import { gunzipSync } from 'node:zlib';
import World from '#models/world';
const GZIP_MAGIC = [0x1f, 0x8b];
export async function readBody(req, limit) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buf = chunk;
        size += buf.length;
        if (size > limit) {
            req.resume();
            return null;
        }
        chunks.push(buf);
    }
    return Buffer.concat(chunks);
}
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024;
export function inflateSave(gzip) {
    try {
        return JSON.parse(gunzipSync(gzip, { maxOutputLength: MAX_INFLATED_BYTES }).toString('utf8'));
    }
    catch {
        return null;
    }
}
export function playerCount(data) {
    const players = data?.players;
    if (!players || typeof players !== 'object' || Array.isArray(players))
        return 1;
    return Math.max(1, Math.min(65535, Object.keys(players).length));
}
export async function storeWorld(userId, kind, bytes, night, seconds) {
    if (!bytes || bytes.length === 0 || bytes.length > World.MAX_BYTES) {
        return { error: `Save must be between 1 byte and ${World.MAX_BYTES / 1024 / 1024} MB.`, status: 413 };
    }
    if (bytes[0] !== GZIP_MAGIC[0] || bytes[1] !== GZIP_MAGIC[1]) {
        return { error: 'Save must be gzip-compressed JSON.', status: 422 };
    }
    const data = inflateSave(bytes);
    if (data === null)
        return { error: 'Save must be gzip-compressed JSON of a sensible size.', status: 422 };
    const values = {
        payload: bytes.toString('base64'),
        size: bytes.length,
        night: Math.max(0, Math.floor(night)),
        seconds: Math.max(0, Math.floor(seconds)),
        players: playerCount(data),
    };
    const existing = userId === null ? await World.global() : await World.query().where('user_id', userId).where('kind', kind).first();
    const world = existing ?? new World().merge({ userId, kind });
    world.merge(values);
    await world.save();
    return { world };
}
//# sourceMappingURL=world_store.js.map