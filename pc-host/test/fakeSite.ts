/**
 * An in-memory stand-in for the site: the global room's mailbox (both sides of it), the
 * global save, scores, access and a scriptable heartbeat.
 */
import type { HeartbeatBody, HeartbeatReply, HostSignal, IceServer, Site } from '../src/site'
import type { SaveData } from '@game/net/api'
import type { Run } from '../src/sim/HostSim'
import type { Player } from '../src/room/GameRoom'
import { DEFAULT_RULES, rulesToWire } from '@game/game/rules'

interface Row extends HostSignal {
  to: string
}

export class FakeSite implements Site {
  rows: Row[] = []
  private nextId = 1
  pcPeer = 'pcPEERpcPEER0001'
  save: SaveData | null = null
  saves = 0
  runs: Run[] = []
  beats: HeartbeatBody[] = []
  problems = new Map<number, string>()
  /** what the next heartbeats answer (the last one repeats) */
  replies: (HeartbeatReply | Error)[] = []
  commands: string[] = []

  // ---------------------------------------------------------------- the PC's side
  async heartbeat(body: HeartbeatBody): Promise<HeartbeatReply> {
    this.beats.push(body)
    if (body.peer_id) this.pcPeer = body.peer_id
    const next = this.replies.length > 1 ? this.replies.shift()! : this.replies[0]
    if (next instanceof Error) throw next
    if (next) return next
    if (body.going) return { state: body.going === 'offline' ? 'offline' : 'paused' }
    const commands = this.commands
    this.commands = []
    return { state: 'online', room: { code: body.room!.code, host_peer_id: body.peer_id, players: body.room!.players }, rules: rulesToWire(DEFAULT_RULES), commands }
  }

  async signals(after: number): Promise<HostSignal[]> {
    return this.rows.filter(r => r.to === this.pcPeer && r.id > after)
  }

  async signal(to: string, type: 'answer' | 'candidate', data: Record<string, unknown>): Promise<void> {
    this.push(this.pcPeer, to, type, data, null)
  }

  async loadWorld(): Promise<SaveData | null> {
    return this.save ? structuredClone(this.save) : null
  }

  async saveWorld(save: SaveData): Promise<void> {
    this.save = structuredClone(save)
    this.saves++
  }

  async recordRuns(runs: Run[]): Promise<void> {
    this.runs.push(...runs)
  }

  async accessProblems(players: readonly Player[]): Promise<(string | null)[]> {
    return players.map(p => this.problems.get(p.userId) ?? null)
  }

  async iceServers(): Promise<IceServer[]> {
    return []
  }

  // ---------------------------------------------------------------- a player's side
  /** a player posts into the mailbox; the site stamps who they are */
  post(from: string, to: string, type: HostSignal['type'], data: Record<string, unknown>, player: Player | null): void {
    this.push(from, to, type, data, player)
  }

  mailFor(peer: string, after: number): HostSignal[] {
    return this.rows.filter(r => r.to === peer && r.id > after)
  }

  private push(from: string, to: string, type: HostSignal['type'], data: Record<string, unknown>, player: Player | null): void {
    this.rows.push({
      id: this.nextId++, from, to, type, data,
      from_user_id: player?.userId ?? null, from_device_id: player?.deviceId ?? null, from_name: player?.name ?? null,
    })
  }
}
