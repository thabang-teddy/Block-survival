/**
 * Wire protocol between the host (authoritative sim) and clients. The host is the
 * server: every room runs in its sim (sim/HostSim.ts) and each player is a client on a
 * WebSocket. Messages are plain objects packed with msgpackr.
 */
import { pack, unpack } from 'msgpackr'
import type { GameRulesWire } from '../game/rules.ts'
import type { ItemStack } from '../items/inventory.ts'
import type { PropMeta } from '../world/chunkStore.ts'
import type { AnimName } from '../game/Avatar.ts'
import type { ZombieKind } from '../entities/zombies.ts'

/** 2: the server hosts (the Laravel app's peer-to-peer hosts spoke 1) */
export const PROTOCOL_VERSION = 2
export const INPUT_HZ = 30
export const SNAPSHOT_HZ = 20
/** clients render remote entities this far behind host time so there is always a pair of snapshots to blend */
export const INTERPOLATION_DELAY = 0.1
export { MAX_PLAYERS } from './limits.ts'

// ---------------------------------------------------------------- shared state shapes
export interface PlayerSnap {
  id: string
  name: string
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  anim: AnimName
  held: string | null
  health: number
  dead: boolean
  kills: number
  deaths: number
}

export interface ZombieSnap {
  id: number
  kind: ZombieKind
  x: number
  y: number
  z: number
  yaw: number
  state: 'chase' | 'attack' | 'burn' | 'dead'
  attacked: boolean
  burnTimer: number
}

export interface DropSnap {
  id: number
  item: string
  x: number
  y: number
  z: number
}

export interface CrateSnap {
  id: number
  x: number
  y: number
  z: number
  items: number
}

/** a block edit: id plus prop metadata when the block is a prop */
export interface BlockEdit {
  x: number
  y: number
  z: number
  id: number
  meta?: PropMeta
}

// ---------------------------------------------------------------- client → host
export type ClientMessage =
  /** the account comes from the ticket the socket was opened with, never from the client */
  | { t: 'hello'; v: number; name: string }
  /** 30 Hz: the client's own movement is authoritative */
  | { t: 'input'; x: number; y: number; z: number; yaw: number; pitch: number; anim: AnimName; slot: number; aiming: boolean }
  | { t: 'break'; x: number; y: number; z: number }
  | { t: 'place'; x: number; y: number; z: number; nx: number; ny: number; nz: number; slot: number; yaw: number }
  | { t: 'craft'; recipe: string }
  | { t: 'moveSlot'; from: number; to: number }
  | { t: 'dropHeld'; slot: number; dx: number; dz: number }
  /** F: interact with the targeted block / crate */
  | { t: 'interact'; x: number; y: number; z: number; block: number; crate: number | null }
  | { t: 'swing'; ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }
  | { t: 'fire'; ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }
  | { t: 'reload' }
  | { t: 'chat'; text: string }
  /** the world's owner asks for a save now (the server also saves on its own) */
  | { t: 'save' }

// ---------------------------------------------------------------- host → client
export interface Welcome {
  t: 'welcome'
  v: number
  you: string
  seed: number
  time: number
  edits: BlockEdit[]
  /** where the player starts: their saved position when they resume, else their spawn */
  spawn: { x: number; y: number; z: number }
  /** which way they were looking when they left (resuming players only) */
  look?: { yaw: number; pitch: number }
  /** the host's game rules (absent from hosts older than the rules feature: defaults apply) */
  rules?: GameRulesWire
}

export interface Snapshot {
  t: 'snap'
  time: number
  players: PlayerSnap[]
  zombies: ZombieSnap[]
  drops: DropSnap[]
  crates: CrateSnap[]
}

/** private per-client state, sent when it changes */
export interface PrivateState {
  t: 'state'
  inventory?: readonly (ItemStack | null)[]
  magazine?: number
  reloading?: boolean
  health?: number
  poisoned?: boolean
  hurtAt?: number
  dead?: boolean
  respawnIn?: number
  teleport?: { x: number; y: number; z: number }
  spawn?: { x: number; y: number; z: number }
  message?: string
  fx?: { kind: 'flash' | 'tracer'; ax: number; ay: number; az: number; bx: number; by: number; bz: number }[]
}

export type HostMessage =
  | Welcome
  | Snapshot
  | PrivateState
  | { t: 'blocks'; edits: BlockEdit[] }
  | { t: 'chat'; from: string; text: string }
  | { t: 'full' }
  | { t: 'bye' }

/** packed bytes in their own buffer (msgpackr packs into a shared scratch buffer) */
export const encode = (msg: ClientMessage | HostMessage): Uint8Array<ArrayBuffer> => new Uint8Array(pack(msg))
export const decode = <T = ClientMessage | HostMessage>(data: ArrayBuffer | Uint8Array): T =>
  unpack(data instanceof Uint8Array ? data : new Uint8Array(data)) as T

// ---------------------------------------------------------------- room codes
export { makeRoomCode, normalizeRoomCode, isRoomCode, ROOM_CODE_LENGTH } from './limits.ts'
