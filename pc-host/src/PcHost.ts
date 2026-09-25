/**
 * The host PC's life (docs/pc-host-research.md §5.2, §5.4): register with the site,
 * hold the global world while the site says it is ours, and follow what the heartbeat
 * says —
 *
 * - online: run the room and answer offers from the mailbox;
 * - standby: the browsers have the world (after a clean shutdown or the admin's
 *   release); send everyone off, save, and wait until the site hands it back;
 * - the site cannot be reached for more than FREEZE_AFTER_MS: freeze the world where
 *   it is, keep everyone's place, and carry on once the heartbeat gets through again.
 *
 * Stopping cleanly always saves first. A restart (Windows stopping the service) keeps
 * the world paused for the players; only `offline` hands it to the browsers.
 */
import { HostSim } from './sim/HostSim'
import { GameRoom, type RoomLog } from './room/GameRoom'
import { HostTransport, type PeerConnectionFactory, type TransportOptions } from './net/HostTransport'
import { SiteError, type HeartbeatReply, type Site } from './site'
import { makeRoomCode } from '@game/net/protocol'
import { GLOBAL_SEED } from '@game/world/seed'
import { DEFAULT_RULES, parseRules, type GameRules } from '@game/game/rules'
import type { SaveData } from '@game/net/api'

export const HEARTBEAT_MS = 15_000
/** heartbeats failing this long mean the PC is cut off: freeze the world (§5.4) */
export const FREEZE_AFTER_MS = 15_000
/** a failed heartbeat is retried sooner than the next regular one */
const RETRY_MS = 5_000
/** TURN credentials are refreshed this often (the site mints them for two hours) */
const ICE_REFRESH_MS = 30 * 60_000

export type HostPhase = 'starting' | 'online' | 'standby' | 'stopped'

export interface PcHostOptions {
  site: Site
  version: string
  makePeer: PeerConnectionFactory
  transport: Omit<TransportOptions, 'iceServers'>
  log: RoomLog
  /** keeps Windows awake while anyone plays */
  keepAwake?: (on: boolean) => void
  /** the token was revoked: there is nothing more this process can do */
  onRevoked?: () => void
  now?: () => number
  /** a peer id for the mailbox (injectable for tests) */
  peerId?: string
}

export class PcHost {
  phase: HostPhase = 'starting'
  room: GameRoom | null = null
  private transport: HostTransport | null = null
  private code = makeRoomCode()
  readonly peerId: string
  private rules: GameRules = DEFAULT_RULES
  private lastOkAt: number
  /** the last heartbeat got through */
  private healthy = true
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  private iceTimer: ReturnType<typeof setInterval> | null = null
  private beating: Promise<void> | null = null
  private readonly now: () => number
  private readonly log: RoomLog

  constructor(private readonly opts: PcHostOptions) {
    this.now = opts.now ?? Date.now
    this.log = opts.log
    this.peerId = opts.peerId ?? makePeerId()
    this.lastOkAt = this.now()
  }

  /** first heartbeat, then the world; resolves once the PC is hosting or standing by */
  async start(): Promise<void> {
    const ice = await this.opts.site.iceServers().catch(() => [])
    this.transport = new HostTransport(this.opts.site, {
      onOpen: (link, player) => this.room?.connect(link, player),
      onData: (link, bytes) => this.room?.receive(link, bytes),
      onClose: link => this.room?.disconnect(link),
    }, this.opts.makePeer, { ...this.opts.transport, iceServers: ice }, (msg, err) => this.log.error(msg, { err: String(err) }))
    this.iceTimer = setInterval(() => {
      this.opts.site.iceServers().then(s => this.transport?.setIceServers(s), () => {})
    }, ICE_REFRESH_MS)
    await this.beat()
    this.schedule(HEARTBEAT_MS)
  }

  /**
   * Stop for good. `restart` (Windows stopping the service for an update or a reboot)
   * keeps the players paused; `offline` hands the world to the browsers.
   */
  async stop(going: 'offline' | 'restart'): Promise<void> {
    if (this.phase === 'stopped') return
    this.phase = 'stopped'
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    if (this.iceTimer) clearInterval(this.iceTimer)
    await this.beating?.catch(() => {})
    this.transport?.stopListening()
    const reason = going === 'offline'
      ? 'The host PC is going offline — the world moves to your browsers.'
      : 'The host PC is restarting — the game is paused until it is back.'
    await this.room?.close(reason)
    this.transport?.dispose()
    this.opts.keepAwake?.(false)
    await this.opts.site.heartbeat({ version: this.opts.version, peer_id: this.peerId, going }).catch(err => {
      this.log.error('the last heartbeat failed', { err: String(err) })
    })
    this.log.info('stopped', { going })
  }

  private schedule(ms: number): void {
    if (this.phase === 'stopped') return
    this.heartbeatTimer = setTimeout(() => {
      void this.beat().finally(() => this.schedule(this.healthy ? HEARTBEAT_MS : RETRY_MS))
    }, ms)
  }

  /** one heartbeat, and whatever its answer means for the room */
  beat(): Promise<void> {
    const run = this.beatOnce().finally(() => { if (this.beating === run) this.beating = null })
    this.beating = run
    return run
  }

  private async beatOnce(): Promise<void> {
    if (this.phase === 'stopped') return
    const room = this.room
    let reply: HeartbeatReply
    try {
      reply = await this.opts.site.heartbeat({
        version: this.opts.version,
        peer_id: this.peerId,
        room: { code: this.code, players: room?.playerCount ?? 0, user_ids: room?.userIds ?? [] },
        stats: this.stats(),
      })
    } catch (err) {
      this.onBeatFailed(err)
      return
    }
    this.healthy = true
    this.lastOkAt = this.now()
    // stop() may have run while the heartbeat was out
    if ((this.phase as HostPhase) === 'stopped') return
    if (reply.state === 'online') await this.online(reply)
    else if (reply.state === 'standby') await this.standby()
    else this.log.info('the site says the PC is not hosting', { state: reply.state })
    this.opts.keepAwake?.((this.room?.playerCount ?? 0) > 0)
  }

  private onBeatFailed(err: unknown): void {
    this.healthy = false
    if (err instanceof SiteError && err.status === 401) {
      this.log.error('the host token was refused — revoked or rotated in the admin; stopping')
      this.opts.onRevoked?.()
      return
    }
    if (err instanceof SiteError && err.status === 409) {
      // our room code belongs to someone else's room: draw another
      this.code = makeRoomCode()
      this.transport?.newRoom()
      this.log.info('room code taken, drawing another', { code: this.code })
      return
    }
    this.log.error('heartbeat failed', { err: String(err) })
    if (this.now() - this.lastOkAt > FREEZE_AFTER_MS) this.room?.freeze()
  }

  private async online(reply: Extract<HeartbeatReply, { state: 'online' }>): Promise<void> {
    if (!this.room || this.room.isClosed) {
      this.rules = parseRules(reply.rules)
      await this.openRoom()
    } else {
      this.room.resume()
    }
    if (reply.commands.includes('reset') && this.room) {
      this.log.info('the admin reset the global world')
      this.room.reset(this.newSim(undefined), 'The global world was reset — join again to start the new one.')
      await this.room.saveNow().catch(() => {})
    }
    this.transport?.listen()
    this.phase = 'online'
  }

  /** the browsers have the world: everyone off (after a save), and wait to be handed it back */
  private async standby(): Promise<void> {
    if (this.phase === 'standby') return
    this.phase = 'standby'
    this.transport?.stopListening()
    const room = this.room
    this.room = null
    if (room) {
      this.log.info('standing by: the browsers host the global world for now')
      await room.close('The global world moved to the players\' browsers.')
    }
    this.opts.keepAwake?.(false)
  }

  /** load the latest global save (browsers may have played it since) and open the room */
  private async openRoom(): Promise<void> {
    const save = await this.opts.site.loadWorld()
    const room = new GameRoom(this.newSim(save ?? undefined), {
      saveWorld: (s, night) => this.opts.site.saveWorld(s, night),
      recordRun: run => this.opts.site.recordRuns([run]),
      accessProblems: players => this.opts.site.accessProblems(players),
    }, this.now, this.log)
    room.onGap = seconds => {
      // the PC slept: the time is discarded; hold the world until the site answers again
      this.log.info('the PC was asleep', { seconds: Math.round(seconds) })
      room.freeze()
      void this.beat()
    }
    room.start()
    this.room = room
    this.transport?.newRoom()
    this.log.info('hosting the global world', { code: this.code, restored: save !== null, night: room.sim.dayNight.night })
  }

  private newSim(restore: SaveData | undefined): HostSim {
    return new HostSim({ seed: GLOBAL_SEED, rules: this.rules, restore })
  }

  private stats(): Record<string, unknown> {
    return { ...(this.transport?.stats ?? {}), frozen: this.room?.isFrozen ?? false, uptime_s: Math.round(process.uptime()) }
  }
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
export function makePeerId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, b => ID_ALPHABET[b % ID_ALPHABET.length]).join('')
}
