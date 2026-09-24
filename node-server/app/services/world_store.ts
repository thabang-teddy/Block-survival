import type { IncomingMessage } from 'node:http'
import { gunzipSync } from 'node:zlib'
import World, { type WorldKind } from '#models/world'

export type StoreResult = { world: World } | { error: string; status: number }

const GZIP_MAGIC = [0x1f, 0x8b]

/** the request body as bytes, or null once it passes `limit` (the rest is not read) */
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > limit) {
      req.resume()
      return null
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

/**
 * The most a save may inflate to. Real saves are a few hundred KB of JSON; the cap keeps
 * a crafted gzip (a few MB that expands to gigabytes) from stalling the process every
 * room shares.
 */
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024

/** the save's JSON, or null when it is not gzip, too big once inflated, or not JSON */
export function inflateSave(gzip: Buffer): unknown {
  try {
    return JSON.parse(gunzipSync(gzip, { maxOutputLength: MAX_INFLATED_BYTES }).toString('utf8'))
  } catch {
    return null
  }
}

/** how many accounts the save holds gear for; older formats held only the host */
export function playerCount(data: unknown): number {
  const players = (data as { players?: unknown } | null)?.players
  if (!players || typeof players !== 'object' || Array.isArray(players)) return 1
  return Math.max(1, Math.min(65535, Object.keys(players).length))
}

/**
 * Validate and write one world: gzip, at most World.MAX_BYTES. `userId` null is the
 * shared global world. Used by the upload endpoints and by the server's own rooms.
 */
export async function storeWorld(userId: number | null, kind: WorldKind, bytes: Buffer | null, night: number, seconds: number): Promise<StoreResult> {
  if (!bytes || bytes.length === 0 || bytes.length > World.MAX_BYTES) {
    return { error: `Save must be between 1 byte and ${World.MAX_BYTES / 1024 / 1024} MB.`, status: 413 }
  }
  if (bytes[0] !== GZIP_MAGIC[0] || bytes[1] !== GZIP_MAGIC[1]) {
    return { error: 'Save must be gzip-compressed JSON.', status: 422 }
  }
  const data = inflateSave(bytes)
  if (data === null) return { error: 'Save must be gzip-compressed JSON of a sensible size.', status: 422 }
  const values = {
    payload: bytes.toString('base64'),
    size: bytes.length,
    night: Math.max(0, Math.floor(night)),
    seconds: Math.max(0, Math.floor(seconds)),
    players: playerCount(data),
  }
  const existing = userId === null ? await World.global() : await World.query().where('user_id', userId).where('kind', kind).first()
  const world = existing ?? new World().merge({ userId, kind })
  world.merge(values)
  await world.save()
  return { world }
}
