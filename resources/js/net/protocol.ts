/**
 * Wire protocol between the host (authoritative sim) and clients.
 * Messages are plain objects packed with msgpackr and sent over PeerJS DataChannels.
 */
import { pack, unpack } from 'msgpackr'
import type { ItemStack } from '../items/inventory'
import type { PropMeta } from '../world/chunkStore'
import type { AnimName } from '../game/Game'
import type { ZombieKind } from '../entities/zombies'

export const PROTOCOL_VERSION = 1
export const INPUT_HZ = 30
export const SNAPSHOT_HZ = 20
/** clients render remote entities this far behind host time so there is always a pair of snapshots to blend */
export const INTERPOLATION_DELAY = 0.1
export const MAX_PLAYERS = 4

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
  /** `userId`: the signed-in account, so the host can hand back gear saved for it */
  | { t: 'hello'; v: number; name: string; userId?: number }
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

// ---------------------------------------------------------------- host → client
export interface Welcome {
  t: 'welcome'
  v: number
  you: string
  seed: number
  time: number
  edits: BlockEdit[]
  spawn: { x: number; y: number; z: number }
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
export const encode = (msg: ClientMessage | HostMessage): Uint8Array => new Uint8Array(pack(msg))
export const decode = <T = ClientMessage | HostMessage>(data: ArrayBuffer | Uint8Array): T =>
  unpack(data instanceof Uint8Array ? data : new Uint8Array(data)) as T

// ---------------------------------------------------------------- room codes
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // no I/O to avoid confusion
export const ROOM_CODE_LENGTH = 6

export function makeRoomCode(random: () => number = Math.random): string {
  let s = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]
  return s
}

export const normalizeRoomCode = (input: string): string => input.toUpperCase().replace(/[^A-Z]/g, '').slice(0, ROOM_CODE_LENGTH)
export const isRoomCode = (code: string): boolean => code.length === ROOM_CODE_LENGTH && [...code].every(c => CODE_ALPHABET.includes(c))
