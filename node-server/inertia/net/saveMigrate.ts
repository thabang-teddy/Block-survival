/**
 * Upgrades older cloud saves to the current SaveData shape.
 *
 * v1 worlds were one floating island at the origin with the pad at y ≈ 6. In v2 that
 * island floats at LEGACY_ISLAND_Y over an endless ground, so every v1 edit is lifted
 * by that much and the player starts on the ground pad instead of the island.
 * v3 (issue #13) keeps every player who has visited, plus live zombies, drops and
 * crates; a v2 save becomes a v3 save holding the host alone.
 */
import type { SaveData, SavedPlayer } from '../game/saveTypes.ts'
import type { BlockEdit } from './protocol.ts'
import { ISLAND_LARGE } from '../world/islandGen.ts'
import { LEGACY_ISLAND_Y } from '../world/islandField.ts'
import { groundSpawn } from '../world/terrainGen.ts'
import { AVATAR } from '../game/Avatar.ts'

/** every v1 world used the classic island seed */
const V1_SEED = ISLAND_LARGE.seed

interface SaveV1 {
  version: 1
  seed?: number
  time: number
  edits: BlockEdit[]
  inventory: SavedPlayer['inventory']
  spawn: { x: number; y: number; z: number }
  kills: number
  deaths: number
}

interface SaveV2 extends Omit<SaveV1, 'version' | 'seed'> {
  version: 2
  seed: number
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function liftEdit(e: BlockEdit, dy: number): BlockEdit {
  const meta = e.meta
    ? { ...e.meta, y: e.meta.y + dy, ...(e.meta.partner ? { partner: { ...e.meta.partner, y: e.meta.partner.y + dy } } : {}) }
    : undefined
  return { ...e, y: e.y + dy, ...(meta ? { meta } : {}) }
}

export function migrateV1(save: SaveV1): SaveV2 {
  const seed = V1_SEED
  return {
    version: 2,
    seed,
    time: save.time,
    edits: save.edits.map(e => liftEdit(e, LEGACY_ISLAND_Y)),
    inventory: save.inventory,
    spawn: groundSpawn(seed),
    kills: save.kills,
    deaths: save.deaths,
  }
}

/** the flat v2 fields become the host's entry under `players`; nothing else was saved */
export function migrateV2(save: SaveV2, userId: number, name = 'Player'): SaveData {
  const host: SavedPlayer = {
    name,
    inventory: save.inventory,
    spawn: save.spawn,
    pos: { ...save.spawn, yaw: 0, pitch: 0 },
    health: AVATAR.maxHealth,
    magazine: 0,
    kills: save.kills,
    deaths: save.deaths,
  }
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
  }
}

/**
 * Parsed save JSON → current SaveData, or null when it is not a save we can read.
 * `userId` is the account the save belongs to: older formats only knew one player.
 */
export function migrateSave(raw: unknown, userId: number): SaveData | null {
  if (!isRecord(raw) || !Array.isArray(raw.edits)) return null
  if (raw.version === 3) return typeof raw.seed === 'number' && isRecord(raw.players) ? (raw as unknown as SaveData) : null
  if (raw.version === 2) return typeof raw.seed === 'number' ? migrateV2(raw as unknown as SaveV2, userId) : null
  if (raw.version === 1) return migrateV2(migrateV1(raw as unknown as SaveV1), userId)
  return null
}
