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

export interface ApiUser {
  id: number
  name: string
  email: string
  is_admin: boolean
}

/** a room the lobby can join in one click; the host's peer id is only revealed by resolveRoom */
export interface OpenRoom {
  code: string
  host_name: string
  players: number
  max_players: number
  expires_at: string
}

export interface LeaderboardRow {
  name: string
  score: number
}

/** summary of the player's one world, as the lobby and the admin show it */
export interface WorldMeta {
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

  /** open (live, not full) rooms, newest first */
  listRooms: () => request<{ rooms: OpenRoom[] }>('GET', '/rooms').then(r => r.rooms),
  createRoom: (code: string, hostPeerId: string, hostName: string) =>
    request<{ room: unknown }>('POST', '/rooms', { code, host_peer_id: hostPeerId, host_name: hostName }),
  refreshRoom: (code: string, hostPeerId: string, players: number) =>
    request<{ room: unknown }>('PATCH', `/rooms/${code}`, { host_peer_id: hostPeerId, players }),
  closeRoom: (code: string, hostPeerId: string) =>
    request<{ ok: boolean }>('DELETE', `/rooms/${code}`, { host_peer_id: hostPeerId }),
  resolveRoom: (code: string) =>
    request<{ room: { code: string; host_peer_id: string; host_name: string; players: number } }>('GET', `/rooms/${code}`),
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

  /** every player has exactly one world; saving replaces it */
  async saveWorld(data: SaveData, night: number): Promise<WorldMeta> {
    const bytes = await gzip(JSON.stringify(data))
    const q = `?night=${night}&seconds=${Math.floor(data.time)}`
    const body = new Blob([bytes as BlobPart], { type: 'application/gzip' })
    return (await request<{ world: WorldMeta }>('PUT', `/world${q}`, undefined, body, { 'Content-Type': 'application/gzip' })).world
  },
  /** the gzipped bytes of a save, prepared ahead of time so an unload can beacon them */
  packWorld: (data: SaveData): Promise<Uint8Array> => gzip(JSON.stringify(data)),
  /**
   * Fire-and-forget save while the page is going away: a beacon cannot carry headers,
   * so the CSRF token travels as a form field. Returns false when the browser refused
   * to queue it (too big, or beacons unsupported).
   */
  beaconWorld(bytes: Uint8Array, night: number, seconds: number): boolean {
    if (typeof navigator.sendBeacon !== 'function' || bytes.byteLength > BEACON_LIMIT) return false
    const form = new FormData()
    form.append('payload', new Blob([bytes as BlobPart], { type: 'application/gzip' }), 'world.json.gz')
    form.append('night', String(night))
    form.append('seconds', String(Math.floor(seconds)))
    form.append('_token', pageCsrfToken())
    return navigator.sendBeacon('/api/world/beacon', form)
  },
  /** the saved world, or null when the player has not saved one yet */
  async loadWorld(): Promise<SaveData | null> {
    let res: Response
    try {
      res = await request<Response>('GET', '/world')
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
    const text = await gunzip(await res.arrayBuffer())
    const data = migrateSave(JSON.parse(text), currentUser?.id ?? 0)
    if (!data) throw new ApiError(422, 'Unreadable save')
    return data
  },
  /** start over: forget the saved world */
  resetWorld: () => request<{ ok: boolean }>('DELETE', '/world').then(() => undefined),
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes: ArrayBuffer): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}
