/**
 * JSON endpoints of the Laravel app (rooms, leaderboard, cloud saves). Same-origin,
 * authenticated by the Inertia session cookie; state-changing calls carry the CSRF
 * token. Every call is best-effort from the game's point of view: the game works
 * fully when logged out or offline.
 */
import type { BlockEdit } from './protocol'
import type { ItemStack } from '../items/inventory'

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

let currentUser: ApiUser | null = null

/** Laravel's XSRF-TOKEN cookie, sent back as a header so VerifyCsrfToken accepts the call */
function csrfToken(): string {
  const m = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/)
  if (m) return decodeURIComponent(m[1])
  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''
}

async function request<T>(method: string, path: string, body?: unknown, raw?: BodyInit, headers: Record<string, string> = {}): Promise<T> {
  const h: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...headers }
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
