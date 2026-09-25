/**
 * The PHP site as the host PC talks to it: every call is a bearer-token request to
 * /api/host/* (docs/pc-host-research.md §5.1). No cookie, no session — the token is the
 * PC's only credential, and it opens nothing but these routes.
 */
import { gunzipSync, gzipSync } from 'node:zlib'
import { migrateSave } from '@game/net/saveMigrate'
import type { SaveData } from '@game/net/api'
import type { GameRulesWire } from '@game/game/rules'
import type { Run } from './sim/HostSim'
import type { Player } from './room/GameRoom'

export class SiteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export interface RoomRow {
  code: string
  host_peer_id: string
  players: number
}

export type HeartbeatReply =
  | { state: 'online'; room: RoomRow; rules: GameRulesWire; commands: string[] }
  | { state: 'standby' }
  | { state: 'paused' }
  | { state: 'offline' }

export interface HeartbeatBody {
  version: string
  peer_id: string
  going?: 'offline' | 'restart'
  room?: { code: string; players: number; user_ids: number[] }
  stats?: Record<string, unknown>
}

/** one row of the global room's mailbox, with who the site says posted it */
export interface HostSignal {
  id: number
  from: string
  type: 'offer' | 'answer' | 'candidate'
  data: Record<string, unknown>
  from_user_id: number | null
  from_device_id: number | null
  from_name: string | null
}

export type IceServer = { urls: string | string[]; username?: string; credential?: string }

/** what the rest of the app needs from the site; a fake stands in for it in tests */
export interface Site {
  heartbeat(body: HeartbeatBody): Promise<HeartbeatReply>
  signals(after: number): Promise<HostSignal[]>
  signal(to: string, type: 'answer' | 'candidate', data: Record<string, unknown>): Promise<void>
  loadWorld(): Promise<SaveData | null>
  saveWorld(save: SaveData, night: number): Promise<void>
  recordRuns(runs: Run[]): Promise<void>
  accessProblems(players: readonly Player[]): Promise<(string | null)[]>
  iceServers(): Promise<IceServer[]>
}

const TIMEOUT_MS = 10_000

export class HttpSite implements Site {
  private readonly base: string

  constructor(siteUrl: string, private readonly token: string, private readonly timeoutMs = TIMEOUT_MS) {
    this.base = siteUrl.replace(/\/+$/, '') + '/api/host'
  }

  heartbeat(body: HeartbeatBody): Promise<HeartbeatReply> {
    return this.json<HeartbeatReply>('POST', '/heartbeat', body)
  }

  async signals(after: number): Promise<HostSignal[]> {
    return (await this.json<{ signals: HostSignal[] }>('GET', `/signals?after=${after}`)).signals
  }

  async signal(to: string, type: 'answer' | 'candidate', data: Record<string, unknown>): Promise<void> {
    await this.json('POST', '/signal', { to, type, data })
  }

  async loadWorld(): Promise<SaveData | null> {
    const res = await this.fetch('GET', '/world')
    if (res.status === 404) return null
    await this.check(res)
    const json: unknown = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8'))
    // the global world has no owner: a pre-v3 save's host gear goes to nobody
    const save = migrateSave(json, 0)
    if (!save) throw new SiteError(422, 'The global save could not be read')
    return save
  }

  async saveWorld(save: SaveData, night: number): Promise<void> {
    const body = gzipSync(JSON.stringify(save))
    const q = `?night=${night}&seconds=${Math.floor(save.time)}`
    await this.check(await this.fetch('PUT', `/world${q}`, body, 'application/gzip'))
  }

  async recordRuns(runs: Run[]): Promise<void> {
    if (runs.length === 0) return
    await this.json('POST', '/scores', {
      runs: runs.map(r => ({ user_id: r.userId, nights: r.nights, kills: r.kills, deaths: r.deaths, seconds: r.seconds })),
    })
  }

  async accessProblems(players: readonly Player[]): Promise<(string | null)[]> {
    const res = await this.json<{ results: { reason: string | null }[] }>('POST', '/access', {
      players: players.map(p => ({ user_id: p.userId, device_id: p.deviceId })),
    })
    return res.results.map(r => r.reason)
  }

  async iceServers(): Promise<IceServer[]> {
    return (await this.json<{ ice_servers: IceServer[] }>('GET', '/ice-servers')).ice_servers
  }

  private async json<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetch(method, path, body === undefined ? undefined : JSON.stringify(body), 'application/json')
    await this.check(res)
    return (await res.json()) as T
  }

  private async fetch(method: string, path: string, body?: BodyInit, type?: string): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${this.token}` }
    if (type && body !== undefined) headers['Content-Type'] = type
    try {
      return await fetch(this.base + path, { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs) })
    } catch (err) {
      throw new SiteError(0, `Could not reach the site: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async check(res: Response): Promise<void> {
    if (res.ok) return
    let message = `HTTP ${res.status}`
    try {
      const data = (await res.json()) as { message?: string }
      if (data.message) message = data.message
    } catch {
      // not JSON: keep the status
    }
    throw new SiteError(res.status, message)
  }
}
