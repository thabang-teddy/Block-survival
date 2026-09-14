/**
 * Upgrades older cloud saves to the current SaveData shape.
 *
 * v1 worlds were one floating island at the origin with the pad at y ≈ 6. In v2 that
 * island floats at LEGACY_ISLAND_Y over an endless ground, so every v1 edit is lifted
 * by that much and the player starts on the ground pad instead of the island.
 */
import type { SaveData } from './api'
import type { BlockEdit } from './protocol'
import { ISLAND_LARGE } from '../world/islandGen'
import { LEGACY_ISLAND_Y } from '../world/islandField'
import { groundSpawn } from '../world/terrainGen'

/** every v1 world used the classic island seed */
const V1_SEED = ISLAND_LARGE.seed

interface SaveV1 {
  version: 1
  seed?: number
  time: number
  edits: BlockEdit[]
  inventory: SaveData['inventory']
  spawn: { x: number; y: number; z: number }
  kills: number
  deaths: number
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function liftEdit(e: BlockEdit, dy: number): BlockEdit {
  const meta = e.meta
    ? { ...e.meta, y: e.meta.y + dy, ...(e.meta.partner ? { partner: { ...e.meta.partner, y: e.meta.partner.y + dy } } : {}) }
    : undefined
  return { ...e, y: e.y + dy, ...(meta ? { meta } : {}) }
}

export function migrateV1(save: SaveV1): SaveData {
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

/** Parsed save JSON → current SaveData, or null when it is not a save we can read. */
export function migrateSave(raw: unknown): SaveData | null {
  if (!isRecord(raw) || !Array.isArray(raw.edits)) return null
  if (raw.version === 2) return typeof raw.seed === 'number' ? (raw as unknown as SaveData) : null
  if (raw.version === 1) return migrateV1(raw as unknown as SaveV1)
  return null
}
