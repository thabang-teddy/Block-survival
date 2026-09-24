/**
 * What goes into a cloud save and how it comes back (issue #13). Pure functions over
 * small interfaces so the round trip is testable without a Game, a canvas or a network.
 * The host is the only writer: it saves every player who has been in the world (the
 * ones still connected and the ones who left), plus the zombies, drops and crates that
 * are live at that moment.
 */
import type { ItemStack } from '../items/inventory.ts'
import type { SaveData, SavedPlayer } from './saveTypes.ts'
import type { BlockEdit } from '../net/protocol.ts'
import type { ZombieKind } from '../entities/zombies.ts'
import type { Phase } from './DayNight.ts'

/** the slice of an Avatar the save reads and writes */
export interface SavableAvatar {
  name: string
  inventory: { all(): readonly (ItemStack | null)[]; replace(items: readonly (ItemStack | null)[]): void }
  spawn: { x: number; y: number; z: number }
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  health: number
  magazine: number
  kills: number
  deaths: number
}

export interface CollectOptions {
  seed: number
  time: number
  edits: BlockEdit[]
  /** connected players with a known account */
  live: Iterable<{ userId: string; avatar: SavableAvatar }>
  /** players who left (or never reconnected since the last load) */
  departed: ReadonlyMap<string, SavedPlayer>
  zombies: Iterable<{ kind: ZombieKind; x: number; y: number; z: number; hp: number; state: string }>
  drops: Iterable<{ item: string; count: number; x: number; y: number; z: number }>
  crates: Iterable<{ x: number; y: number; z: number; items: readonly ItemStack[] }>
  now?: number
}

/** newest drops kept in a save; older ones are just gone */
export const MAX_SAVED_DROPS = 500

export function savedPlayerOf(a: SavableAvatar): SavedPlayer {
  return {
    name: a.name,
    inventory: a.inventory.all().map(s => (s ? { ...s } : null)),
    spawn: { ...a.spawn },
    pos: { x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: a.pitch },
    health: a.health,
    magazine: a.magazine,
    kills: a.kills,
    deaths: a.deaths,
  }
}

export function collectSave(o: CollectOptions): SaveData {
  const players: Record<string, SavedPlayer> = {}
  for (const [id, p] of o.departed) players[id] = p
  for (const { userId, avatar } of o.live) players[userId] = savedPlayerOf(avatar) // a live player wins over a stale entry
  const drops = [...o.drops].map(d => ({ id: d.item, count: d.count, x: d.x, y: d.y, z: d.z }))
  return {
    version: 3,
    seed: o.seed,
    time: o.time,
    edits: o.edits,
    players,
    // burning / dead zombies are already on their way out
    zombies: [...o.zombies]
      .filter(z => z.state === 'chase' || z.state === 'attack')
      .map(z => ({ kind: z.kind, x: z.x, y: z.y, z: z.z, hp: z.hp })),
    drops: drops.slice(Math.max(0, drops.length - MAX_SAVED_DROPS)),
    crates: [...o.crates].map(c => ({ x: c.x, y: c.y, z: c.z, items: c.items.map(s => ({ ...s })) })),
    savedAt: o.now ?? Date.now(),
  }
}

/**
 * Give a player their saved self back. The host (`pose: true`) resumes exactly where
 * they were; a visitor rejoining gets gear, spawn and score but starts at their spawn
 * with full health, so nobody reappears mid-fight after days away.
 */
export function restorePlayer(a: SavableAvatar, p: SavedPlayer, pose: boolean): void {
  a.inventory.replace(p.inventory)
  a.spawn = { ...p.spawn }
  a.kills = p.kills
  a.deaths = p.deaths
  a.magazine = p.magazine
  if (!pose) return
  a.x = p.pos.x
  a.y = p.pos.y
  a.z = p.pos.z
  a.yaw = p.pos.yaw
  a.pitch = p.pos.pitch
  a.health = p.health
}

/** zombies only come back when the saved clock is still in the night they belong to */
export function zombiesToRestore(save: SaveData, phaseAt: (time: number) => Phase): SaveData['zombies'] {
  return phaseAt(save.time) === 'night' ? save.zombies : []
}

/** everyone in the save except the given account */
export function visitorsOf(save: SaveData, hostUserId: string): Map<string, SavedPlayer> {
  const out = new Map<string, SavedPlayer>()
  for (const [id, p] of Object.entries(save.players)) if (id !== hostUserId) out.set(id, p)
  return out
}
