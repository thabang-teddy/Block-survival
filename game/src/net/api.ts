/**
 * Laravel API client (accounts, rooms, leaderboard, cloud saves). Token auth via
 * Sanctum bearer tokens kept in localStorage. Every call is best-effort from the
 * game's point of view: the game works fully offline / logged out.
 */
import type { BlockEdit } from './protocol'
import type { ItemStack } from '../items/inventory'

const TOKEN_KEY = 'block-survival:token'
const USER_KEY = 'block-survival:user'
/** same-origin in dev (Vite proxies /api to Laravel); override with VITE_API_URL for a deployed API */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export interface ApiUser {
  id: number
  name: string
  email: string
}

export interface LeaderboardRow {
  name: string
  score: number
}

export interface SaveMeta {
  slot: string
  size: number
  night: number
  seconds: number
  updated_at: string
}

/** what a cloud save contains (gzipped JSON) */
export interface SaveData {
  version: 1
  seed: number
  time: number
  edits: BlockEdit[]
  inventory: readonly (ItemStack | null)[]
  spawn: { x: number; y: number; z: number }
  kills: number
  deaths: number
}

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const store = {
  get token(): string | null {
    try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
  },
  get user(): ApiUser | null {
    try { return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') } catch { return null }
  },
  set(token: string | null, user: ApiUser | null): void {
    try {
      if (token && user) {
        localStorage.setItem(TOKEN_KEY, token)
        localStorage.setItem(USER_KEY, JSON.stringify(user))
      } else {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(USER_KEY)
      }
    } catch { /* private mode */ }
  },
}

async function request<T>(method: string, path: string, body?: unknown, raw?: BodyInit, headers: Record<string, string> = {}): Promise<T> {
  const h: Record<string, string> = { Accept: 'application/json', ...headers }
  const token = store.token
  if (token) h.Authorization = `Bearer ${token}`
  let payload: BodyInit | undefined = raw
  if (body !== undefined) {
    h['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(`${BASE}/api${path}`, { method, headers: h, body: payload })
  } catch {
    throw new ApiError(0, 'Could not reach the server')
  }
  if (res.status === 401 && token) store.set(null, null) // token revoked / expired
  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await res.json() : null
  if (!res.ok) {
    const msg = data?.message ?? (data?.errors ? String(Object.values(data.errors).flat()[0]) : `HTTP ${res.status}`)
    throw new ApiError(res.status, msg)
  }
  return (data ?? res) as T
}

export const api = {
  get user(): ApiUser | null { return store.user },
  get loggedIn(): boolean { return store.token !== null },

  async register(name: string, email: string, password: string): Promise<ApiUser> {
    const r = await request<{ token: string; user: ApiUser }>('POST', '/auth/register', { name, email, password })
    store.set(r.token, r.user)
    return r.user
  },
  async login(email: string, password: string): Promise<ApiUser> {
    const r = await request<{ token: string; user: ApiUser }>('POST', '/auth/login', { email, password })
    store.set(r.token, r.user)
    return r.user
  },
  async logout(): Promise<void> {
    try { await request('POST', '/auth/logout') } catch { /* already gone */ }
    store.set(null, null)
  },

  createRoom: (code: string, hostPeerId: string, hostName: string) =>
    request<{ room: unknown }>('POST', '/rooms', { code, host_peer_id: hostPeerId, host_name: hostName }),
  refreshRoom: (code: string, hostPeerId: string, players: number) =>
    request<{ room: unknown }>('PATCH', `/rooms/${code}`, { host_peer_id: hostPeerId, players }),
  closeRoom: (code: string, hostPeerId: string) =>
    request<{ ok: boolean }>('DELETE', `/rooms/${code}`, { host_peer_id: hostPeerId }),
  resolveRoom: (code: string) =>
    request<{ room: { code: string; host_peer_id: string; host_name: string; players: number } }>('GET', `/rooms/${code}`),

  postScore: (nights: number, kills: number, deaths: number, seconds: number) =>
    request<{ score: number; best: number }>('POST', '/scores', { nights, kills, deaths, seconds }),
  leaderboard: async (): Promise<LeaderboardRow[]> =>
    (await request<{ leaderboard: LeaderboardRow[] }>('GET', '/leaderboard')).leaderboard,

  listSaves: async (): Promise<SaveMeta[]> => (await request<{ saves: SaveMeta[] }>('GET', '/saves')).saves,
  async saveGame(slot: string, data: SaveData, night: number): Promise<SaveMeta> {
    const bytes = await gzip(JSON.stringify(data))
    const q = `?night=${night}&seconds=${Math.floor(data.time)}`
    const body = new Blob([bytes as BlobPart], { type: 'application/gzip' })
    return (await request<{ save: SaveMeta }>('PUT', `/saves/${slot}${q}`, undefined, body, { 'Content-Type': 'application/gzip' })).save
  },
  async loadGame(slot: string): Promise<SaveData> {
    const res = await request<Response>('GET', `/saves/${slot}`)
    const text = await gunzip(await res.arrayBuffer())
    const data = JSON.parse(text) as SaveData
    if (data.version !== 1 || !Array.isArray(data.edits)) throw new ApiError(422, 'Unreadable save')
    return data
  },
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes: ArrayBuffer): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}
