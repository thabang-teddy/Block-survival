/**
 * What a saved world holds (issue #13), shared by the host sim, the save migration and
 * the API client. Types only.
 */
import type { BlockEdit } from '../net/protocol.ts'
import type { ItemStack } from '../items/inventory.ts'
import type { ZombieKind } from '../entities/zombies.ts'

/** one player's gear and standing in a saved world, keyed by their user id */
export interface SavedPlayer {
  name: string
  inventory: readonly (ItemStack | null)[]
  spawn: { x: number; y: number; z: number }
  pos: { x: number; y: number; z: number; yaw: number; pitch: number }
  health: number
  magazine: number
  kills: number
  deaths: number
}

/**
 * What a saved world contains (gzipped JSON). The seed regenerates the terrain and
 * `edits` is the diff on top of it; version 3 (issue #13) also keeps everyone who has
 * played in the world, and the zombies, drops and crates that were live at save time.
 */
export interface SaveData {
  version: 3
  seed: number
  time: number
  edits: BlockEdit[]
  players: Record<string, SavedPlayer>
  zombies: { kind: ZombieKind; x: number; y: number; z: number; hp: number }[]
  drops: { id: string; count: number; x: number; y: number; z: number }[]
  crates: { x: number; y: number; z: number; items: (ItemStack | null)[] }[]
  /** Date.now() on the host when the save was built */
  savedAt: number
}
