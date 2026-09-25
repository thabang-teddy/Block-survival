/**
 * JSON endpoints of the Laravel app (rooms, leaderboard, cloud saves). Same-origin,
 * authenticated by the Inertia session cookie; state-changing calls carry the CSRF
 * token. Every call is best-effort from the game's point of view: the game works
 * fully when logged out or offline.
 */
import type { BlockEdit } from './protocol'
import { migrateSave } from './saveMigrate'
import type { ItemStack } from '../items/inventory'
import type { ZombieKind } from '../entities/zombies'
import type { WorldKind } from '../world/seed'

export interface ApiUser {
  id: number
  name: string
  email: string
  is_admin: boolean
}

/** an invitation into someone's room, as the invitee's lobby sees it (no peer id until accepted) */
export interface Invite {
  id: number
  code: string
  host_name: string
  world_kind: WorldKind
  players: number
  max_players: number
  expires_at: string
  status: 'pending' | 'accepted' | 'declined'
}

/** the host's view of one invitation */
export interface HostInvite {
  id: number
  user_id: number
  name: string
  status: 'pending' | 'accepted' | 'declined'
}

export interface PlayerRow {
  id: number
  name: string
}

export interface RoomInfo {
  code: string
  host_peer_id: string
  host_name: string
  world_kind: WorldKind
  players: number
  expires_at: string
}

/** who is in the shared global world right now (the lobby card and the admin) */
export interface GlobalPresence {
  online: number
  host_name: string | null
  /** the host PC holds the world but is away: the world waits for it */
  paused?: boolean
}

/**
 * What the global world tells a player who is in it: open a room (`host`), connect to
 * the host's (`client`: the host PC's or a browser's), wait for the chosen host to open
 * theirs (`pending`), or wait for the paused host PC (`paused`).
 */
export type GlobalState =
  | { status: 'host'; online: number; host?: 'browser' }
  | { status: 'client'; room: RoomInfo; online: number; host?: 'pc' | 'browser' }
  | { status: 'pending'; host_name: string; online: number; host?: 'browser' }
  /** the host PC holds the world but is away (docs/pc-host-research.md §5.4): wait for it */
  | { status: 'paused'; host_name: string; online: number; host: 'pc' }

export interface LeaderboardRow {
  name: string
  score: number
}

/** summary of one of the player's worlds, as the lobby and the admin show it */
export interface WorldMeta {
  kind: WorldKind
  size: number
  night: number
  seconds: number
  /** how many different players' gear the save holds (host included) */
  players: number
  updated_at: string
}

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

/** the sendBeacon queue holds this much per page; a bigger save cannot go out on unload */
export const BEACON_LIMIT = 60 * 1024

export interface SignalRow {
  id: number
  from: string
  type: 'offer' | 'answer' | 'candidate'
  data: Record<string, unknown>
}

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

let currentUser: ApiUser | null = null

/** the plain session token from the page head; the only form the `_token` field accepts */
const pageCsrfToken = (): string => document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''

/** Laravel's XSRF-TOKEN cookie, sent back as a header so VerifyCsrfToken accepts the call */
function csrfToken(): string {
  const m = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/)
  if (m) return decodeURIComponent(m[1])
  return pageCsrfToken()
}

async function request<T>(method: string, path: string, body?: unknown, raw?: BodyInit, headers: Record<string, string> = {}): Promise<T> {
  const h: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...headers }
  for (const k of Object.keys(h)) if (h[k] === '') delete h[k]
  if (method !== 'GET') h['X-XSRF-TOKEN'] = csrfToken()
  let payload: BodyInit | undefined = raw
  if (body !== undefined) {
    h['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(`/api${path}`, { method, headers: h, body: payload, credentials: 'same-origin' })
  } catch {
    throw new ApiError(0, 'Could not reach the server')
  }
  if (res.status === 401) currentUser = null // session expired
  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await res.json() : null
  if (!res.ok) {
    const msg = data?.message ?? (data?.errors ? String(Object.values(data.errors).flat()[0]) : `HTTP ${res.status}`)
    throw new ApiError(res.status, msg)
  }
  return (data ?? res) as T
}

export const api = {
  get user(): ApiUser | null { return currentUser },
  get loggedIn(): boolean { return currentUser !== null },
  /** the page tells us who is signed in (Inertia shared prop) */
  setUser(user: ApiUser | null): void { currentUser = user },

  createRoom: (code: string, hostPeerId: string, hostName: string, worldKind: WorldKind = 'own') =>
    request<{ room: RoomInfo }>('POST', '/rooms', { code, host_peer_id: hostPeerId, host_name: hostName, world_kind: worldKind }),
  /** the host's heartbeat; in the global world the accounts it lists keep their seats */
  refreshRoom: (code: string, hostPeerId: string, players: number, userIds: number[] = []) =>
    request<{ room: unknown }>('PATCH', `/rooms/${code}`, { host_peer_id: hostPeerId, players, user_ids: userIds }),
  closeRoom: (code: string, hostPeerId: string) =>
    request<{ ok: boolean }>('DELETE', `/rooms/${code}`, { host_peer_id: hostPeerId }),
  /** the host's peer id — only for the host and accepted invitees (issue #5), or anyone seated in the global world */
  resolveRoom: (code: string) => request<{ room: RoomInfo }>('GET', `/rooms/${code}`),
  // ---- the shared global world: a queue of the players inside it, hosted by its front
  /** enter from the lobby (at the back of the queue) */
  joinGlobal: () => request<GlobalState>('POST', '/global/join'),
  /** still inside, but the host went away: who hosts now? (keeps my seat fresh) */
  claimGlobal: () => request<GlobalState>('POST', '/global/claim'),
  leaveGlobal: () => request<{ ok: boolean }>('POST', '/global/leave').then(() => undefined),
  // ---- invitations (issue #5)
  /** every other player the host may invite */
  players: () => request<{ players: PlayerRow[] }>('GET', '/players').then(r => r.players),
  invite: (code: string, userId: number) =>
    request<{ invite: HostInvite }>('POST', `/rooms/${code}/invites`, { user_id: userId }).then(r => r.invite),
  /** the host's list: who was invited and where they stand */
  roomInvites: (code: string) => request<{ invites: HostInvite[] }>('GET', `/rooms/${code}/invites`).then(r => r.invites),
  /** my pending invites into rooms that still have a seat */
  invites: () => request<{ invites: Invite[] }>('GET', '/invites').then(r => r.invites),
  acceptInvite: (id: number) => request<{ invite: Invite; room: RoomInfo }>('POST', `/invites/${id}/accept`),
  declineInvite: (id: number) => request<{ ok: boolean }>('POST', `/invites/${id}/decline`).then(() => undefined),
  /** drop one WebRTC signalling message into the room's mailbox */
  signal: (code: string, msg: { from: string; to: string; type: string; data: Record<string, unknown> }) =>
    request<{ id: number }>('POST', `/rooms/${code}/signal`, msg).then(() => undefined),
  /** everything addressed to `to` with an id past `after`, oldest first */
  signals: (code: string, to: string, after: number) =>
    request<{ signals: SignalRow[] }>('GET', `/rooms/${code}/signals?to=${encodeURIComponent(to)}&after=${after}`),

  postScore: (nights: number, kills: number, deaths: number, seconds: number) =>
    request<{ score: number; best: number }>('POST', '/scores', { nights, kills, deaths, seconds }),
  leaderboard: async (): Promise<LeaderboardRow[]> =>
    (await request<{ leaderboard: LeaderboardRow[] }>('GET', '/leaderboard')).leaderboard,

  /** every player has one own world; the global world is one shared save its host uploads. Saving replaces it */
  async saveWorld(data: SaveData, night: number, kind: WorldKind = 'own'): Promise<WorldMeta> {
    const bytes = await gzip(JSON.stringify(data))
    const q = `?night=${night}&seconds=${Math.floor(data.time)}`
    const body = new Blob([bytes as BlobPart], { type: 'application/gzip' })
    return (await request<{ world: WorldMeta }>('PUT', `/world/${kind}${q}`, undefined, body, { 'Content-Type': 'application/gzip' })).world
  },
  /** the gzipped bytes of a save, prepared ahead of time so an unload can beacon them */
  packWorld: (data: SaveData): Promise<Uint8Array> => gzip(JSON.stringify(data)),
  /**
   * Fire-and-forget save while the page is going away: a beacon cannot carry headers,
   * so the CSRF token travels as a form field. Returns false when the browser refused
   * to queue it (too big, or beacons unsupported).
   */
  beaconWorld(bytes: Uint8Array, night: number, seconds: number, kind: WorldKind = 'own'): boolean {
    if (typeof navigator.sendBeacon !== 'function' || bytes.byteLength > BEACON_LIMIT) return false
    const form = new FormData()
    form.append('payload', new Blob([bytes as BlobPart], { type: 'application/gzip' }), 'world.json.gz')
    form.append('night', String(night))
    form.append('seconds', String(Math.floor(seconds)))
    form.append('_token', pageCsrfToken())
    return navigator.sendBeacon(`/api/world/${kind}/beacon`, form)
  },
  /** the saved world, or null when nobody has saved one yet */
  async loadWorld(kind: WorldKind = 'own'): Promise<SaveData | null> {
    let res: Response
    try {
      res = await request<Response>('GET', `/world/${kind}`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
    const text = await gunzip(await res.arrayBuffer())
    const data = migrateSave(JSON.parse(text), currentUser?.id ?? 0)
    if (!data) throw new ApiError(422, 'Unreadable save')
    return data
  },
  /** start over: forget the player's own world (an admin resets the global one) */
  resetWorld: () => request<{ ok: boolean }>('DELETE', '/world/own').then(() => undefined),
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes: ArrayBuffer): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}
