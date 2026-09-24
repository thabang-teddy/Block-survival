/**
 * JSON endpoints of the app (getting into a game, invitations, the leaderboard, the
 * player's world). Same-origin, authenticated by the Inertia session cookie;
 * state-changing calls carry the CSRF token. The game itself runs on the server and
 * saves itself; this is only the way in.
 */
import type { WorldKind } from '../world/seed'

export interface ApiUser {
  id: number
  name: string
  email: string
  is_admin: boolean
}

/** an invitation into someone's room, as the invitee's lobby sees it */
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
}

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

export type { SavedPlayer, SaveData } from '../game/saveTypes'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

let currentUser: ApiUser | null = null

/** the session's CSRF token as the page head carried it */
const pageCsrfToken = (): string => document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''

/** the XSRF-TOKEN cookie, sent back as a header so the CSRF check accepts the call */
function csrfToken(): string {
  const m = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/)
  if (m) return decodeURIComponent(m[1])
  return pageCsrfToken()
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const h: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
  if (method !== 'GET') h['X-XSRF-TOKEN'] = csrfToken()
  let payload: BodyInit | undefined
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
  return data as T
}

/** a game on the server and the one-time ticket to open its socket with */
export interface PlayTicket {
  room: RoomInfo
  ticket: string
}

export const api = {
  get user(): ApiUser | null { return currentUser },
  get loggedIn(): boolean { return currentUser !== null },
  /** the page tells us who is signed in (Inertia shared prop) */
  setUser(user: ApiUser | null): void { currentUser = user },

  /** the player's own world or the shared global one, opened on the server if nobody is in it */
  play: (world: WorldKind) => request<PlayTicket>('POST', '/play', { world }),
  /** a running room by code: one we were invited into, or the one we dropped out of */
  join: (code: string) => request<PlayTicket>('POST', `/rooms/${code}/join`),
  // ---- invitations (issue #5)
  /** every other player the owner may invite */
  players: () => request<{ players: PlayerRow[] }>('GET', '/players').then(r => r.players),
  invite: (code: string, userId: number) =>
    request<{ invite: HostInvite }>('POST', `/rooms/${code}/invites`, { user_id: userId }).then(r => r.invite),
  /** the owner's list: who was invited and where they stand */
  roomInvites: (code: string) => request<{ invites: HostInvite[] }>('GET', `/rooms/${code}/invites`).then(r => r.invites),
  /** my pending invites into rooms that still have a seat */
  invites: () => request<{ invites: Invite[] }>('GET', '/invites').then(r => r.invites),
  acceptInvite: (id: number) => request<{ invite: Invite; room: RoomInfo }>('POST', `/invites/${id}/accept`),
  declineInvite: (id: number) => request<{ ok: boolean }>('POST', `/invites/${id}/decline`).then(() => undefined),

  leaderboard: async (): Promise<LeaderboardRow[]> =>
    (await request<{ leaderboard: LeaderboardRow[] }>('GET', '/leaderboard')).leaderboard,
  /** start over: forget the player's own world (an admin resets the global one) */
  resetWorld: () => request<{ ok: boolean }>('DELETE', '/world/own').then(() => undefined),
}
