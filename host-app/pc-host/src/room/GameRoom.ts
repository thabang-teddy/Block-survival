/**
 * The global world as the host PC runs it: a HostSim ticked at TICK_HZ, the players
 * connected to it over WebRTC, and its saving (restored from the removed node-server's
 * game_room.ts, docs/pc-host-research.md §5.2 and §5.4).
 *
 * Players are who the site says they are: the transport hands over the identity PHP put
 * on their offer, and whatever a client's hello claims about itself is ignored. They send
 * validated ClientMessages and get snapshots, block edits and their private state back.
 *
 * While the PC is away from the site (a network blip, sleep) the room is frozen: no
 * ticks, so zombies cannot kill players who cannot move, and no snapshots, so clients
 * notice the silence and wait. Everyone who drops out — frozen or not — has their place
 * kept, and gets it back (same spot, same state) if they return within RETURN_WINDOW_MS
 * of the PC being back.
 */
import { HostSim, type Run } from '../sim/HostSim'
import { validateClientMessage } from '../sim/validate'
import { decode, encode, MAX_PLAYERS, PROTOCOL_VERSION, SNAPSHOT_HZ, type HostMessage } from '@game/net/protocol'
import { Autosave } from '@game/game/autosave'
import { restorePlayer, savedPlayerOf } from '@game/game/saveState'
import type { Avatar } from '@game/game/Avatar'
import type { SavedPlayer, SaveData } from '@game/net/api'

/** one player's connection, as the room sees it (a DataChannel in production, a fake in tests) */
export interface Peer {
  readonly id: string
  send(bytes: Uint8Array): void
  close(): void
}

/** who a connection belongs to, as the site vouched for it on the offer */
export interface Player {
  userId: number
  name: string
  deviceId: number | null
}

/** what the room needs from the site */
export interface RoomStore {
  saveWorld(save: SaveData, night: number): Promise<void>
  recordRun(run: Run): Promise<void>
  /** for each player, why they may no longer play (account disabled, window closed, device revoked), or null */
  accessProblems(players: readonly Player[]): Promise<(string | null)[]>
}

export interface RoomLog {
  info(msg: string, data?: Record<string, unknown>): void
  error(msg: string, data?: Record<string, unknown>): void
}

interface Seat extends Player {
  peer: Peer
  /** null until the client's hello */
  avatar: Avatar | null
  /** messages received in the current one-second window */
  received: number
  /** when the connection was seated (ms), to drop one that never says hello */
  since: number
}

/** a player who dropped out: their spot and state, kept for when they come back */
interface Held {
  saved: SavedPlayer
  /** when they dropped (ms) */
  at: number
}

export const TICK_HZ = 30
/** connected players are re-checked against the access gates this often (seconds) */
const ACCESS_CHECK_SECONDS = 30
/** inputs at 30 Hz plus actions; a client sending more than this in a second is dropped */
const MAX_MESSAGES_PER_SECOND = 240
/** a connection that has not said hello by then is dropped (ms) */
const HELLO_TIMEOUT_MS = 10_000
/** connections waiting for their hello, at most */
const MAX_WAITING = 8
/**
 * Once the PC is back (or right away, if it never went), a player who dropped out has
 * this long to reconnect into their old spot — the same as an empty room's grace in the
 * old RoomRegistry. After that they start from their spawn, as after any leave.
 */
export const RETURN_WINDOW_MS = 60_000
/** a gap between ticks longer than this is the PC having slept: the time is discarded, not simulated */
export const MAX_TICK_GAP_SECONDS = 2

const NOOP_LOG: RoomLog = { info: () => {}, error: () => {} }

export class GameRoom {
  sim: HostSim
  private readonly seats = new Map<string, Seat>()
  private readonly held = new Map<number, Held>()
  private autosave: Autosave
  private timer: ReturnType<typeof setInterval> | null = null
  private lastTick = 0
  private snapshotTimer = 0
  private accessTimer = 0
  private rateTimer = 0
  private signature = ''
  private closed = false
  private frozen = false
  /** when the PC was last back (ms): the return window runs from here */
  private backSince: number
  /** the room noticed a gap it did not simulate (the PC slept) */
  onGap: ((seconds: number) => void) | null = null

  constructor(
    sim: HostSim,
    private readonly store: RoomStore,
    private readonly now: () => number = Date.now,
    private readonly log: RoomLog = NOOP_LOG,
  ) {
    this.sim = sim
    this.backSince = now()
    this.autosave = this.makeAutosave()
    this.wire(sim)
  }

  get playerCount(): number {
    let n = 0
    for (const s of this.seats.values()) if (s.avatar) n++
    return n
  }

  /** the accounts playing right now, for the heartbeat (their seats in the queue stay fresh) */
  get userIds(): number[] {
    return [...this.seats.values()].filter(s => s.avatar).map(s => s.userId)
  }

  get isFrozen(): boolean {
    return this.frozen
  }

  get isClosed(): boolean {
    return this.closed
  }

  /** accounts whose place is being kept */
  get heldUserIds(): number[] {
    return [...this.held.keys()]
  }

  start(): void {
    if (this.timer) return
    this.lastTick = this.now()
    this.timer = setInterval(() => {
      const t = this.now()
      const dt = (t - this.lastTick) / 1000
      this.lastTick = t
      this.tick(dt)
    }, 1000 / TICK_HZ)
  }

  // ================================================================ freezing
  /** the PC lost the site: stop the world where it is and keep everyone's place */
  freeze(): void {
    if (this.frozen || this.closed) return
    this.frozen = true
    this.log.info('room frozen', { players: this.playerCount })
  }

  /** the PC is back: the world goes on from where it stopped, and the return window starts */
  resume(): void {
    if (!this.frozen) return
    this.frozen = false
    this.backSince = this.now()
    // the time spent frozen is not played
    this.lastTick = this.now()
    this.log.info('room resumed', { players: this.playerCount, held: this.held.size })
  }

  // ================================================================ connections
  /** a connection whose offer the site vouched for; the player joins once it says hello */
  connect(peer: Peer, player: Player): void {
    if (this.closed) {
      this.send(peer, { t: 'bye' })
      peer.close()
      return
    }
    // one seat per account: a second tab (or a reconnect racing the old link) replaces the first
    for (const seat of [...this.seats.values()]) {
      if (seat.userId !== player.userId) continue
      this.send(seat.peer, { t: 'bye' })
      seat.peer.close()
      this.disconnect(seat.peer)
    }
    if (this.seats.size - this.playerCount >= MAX_WAITING) {
      peer.close()
      return
    }
    this.seats.set(peer.id, { ...player, name: player.name.slice(0, 16) || 'Survivor', peer, avatar: null, received: 0, since: this.now() })
  }

  /** one message from a player; one that trips a bug is logged and dropped rather than allowed to stop the world */
  receive(peer: Peer, bytes: Uint8Array): void {
    try {
      this.handle(peer, bytes)
    } catch (err) {
      this.log.error('a game message failed', { err: String(err) })
    }
  }

  private handle(peer: Peer, bytes: Uint8Array): void {
    const seat = this.seats.get(peer.id)
    if (!seat) return
    if (++seat.received > MAX_MESSAGES_PER_SECOND) {
      peer.close()
      this.disconnect(peer)
      return
    }
    let raw: unknown
    try {
      raw = decode(bytes)
    } catch {
      return
    }
    const msg = validateClientMessage(raw)
    if (!msg) return
    if (!seat.avatar) {
      if (msg.t === 'hello') this.hello(seat, msg.v)
      return
    }
    // a frozen world takes no actions: they would land in a world nobody sees move
    if (this.frozen) return
    this.sim.apply(seat.avatar, msg)
  }

  disconnect(peer: Peer): void {
    const seat = this.seats.get(peer.id)
    if (!seat) return
    this.seats.delete(peer.id)
    if (!seat.avatar) return
    this.held.set(seat.userId, { saved: savedPlayerOf(seat.avatar), at: this.now() })
    this.sim.removePlayer(seat.avatar.id)
    this.sim.broadcastMessage(`${seat.avatar.name} left`)
    // what they carried goes into the save now, not a minute from now
    this.saveSoon()
  }

  private hello(seat: Seat, version: number): void {
    if (version !== PROTOCOL_VERSION) {
      this.sendState(seat.peer, 'This page is out of date — reload it to play.')
      this.drop(seat)
      return
    }
    if (this.playerCount >= MAX_PLAYERS) {
      this.send(seat.peer, { t: 'full' })
      this.drop(seat)
      return
    }
    const avatar = this.sim.addPlayer(seat.peer.id, seat.name, seat.userId)
    const held = this.held.get(seat.userId)
    if (held) {
      // back into the spot they left, in the state they left it
      restorePlayer(avatar, held.saved, true)
      this.held.delete(seat.userId)
    }
    seat.avatar = avatar
    this.send(seat.peer, this.sim.welcome(avatar))
    this.send(seat.peer, this.sim.initialState(avatar))
    this.sim.broadcastMessage(`${avatar.name} ${held ? 'is back' : 'joined'}`)
  }

  private drop(seat: Seat): void {
    this.send(seat.peer, { t: 'bye' })
    seat.peer.close()
    this.seats.delete(seat.peer.id)
  }

  // ================================================================ tick
  /** one step of the room; a failure is logged and the room carries on with the next */
  tick(dt: number): void {
    if (this.closed) return
    if (dt > MAX_TICK_GAP_SECONDS) {
      // the PC slept (or the process was suspended): discard the time, do not play it
      this.onGap?.(dt)
      dt = 0
    }
    try {
      this.step(dt)
    } catch (err) {
      this.log.error('a game tick failed', { err: String(err) })
    }
  }

  private step(dt: number): void {
    this.rateTimer += dt
    if (this.rateTimer >= 1) {
      this.rateTimer = 0
      for (const seat of this.seats.values()) seat.received = 0
    }
    this.tickHousekeeping(dt)
    if (this.frozen) return

    if (this.playerCount > 0) this.sim.tick(dt)
    const edits = this.sim.takeBlockEdits()
    if (edits.length) this.broadcast({ t: 'blocks', edits })
    this.snapshotTimer += dt
    if (this.snapshotTimer >= 1 / SNAPSHOT_HZ) {
      // carry the remainder: at TICK_HZ ticks this still averages SNAPSHOT_HZ
      this.snapshotTimer = Math.min(this.snapshotTimer - 1 / SNAPSHOT_HZ, 1 / SNAPSHOT_HZ)
      if (this.playerCount > 0) this.broadcast(this.sim.snapshot())
    }
    for (const seat of this.seats.values()) {
      if (!seat.avatar) continue
      const state = this.sim.takeState(seat.avatar)
      if (state) this.send(seat.peer, state)
    }
    this.tickSaving(dt)
  }

  /** notice changes worth saving (a cheap fingerprint, so nothing has to remember to mark dirty) and run the autosave clock */
  private tickSaving(dt: number): void {
    const sig = this.sim.saveSignature()
    if (this.signature === '') this.signature = sig
    else if (sig !== this.signature) {
      this.signature = sig
      this.autosave.markDirty()
    }
    this.autosave.tick(dt)
  }

  private tickHousekeeping(dt: number): void {
    const now = this.now()
    for (const seat of [...this.seats.values()]) {
      if (seat.avatar || now - seat.since < HELLO_TIMEOUT_MS) continue
      seat.peer.close()
      this.seats.delete(seat.peer.id)
    }
    // places are kept for the whole freeze, then for the return window once the PC is back
    if (!this.frozen) {
      for (const [userId, h] of this.held) {
        if (now - Math.max(h.at, this.backSince) >= RETURN_WINDOW_MS) this.held.delete(userId)
      }
    }
    this.accessTimer += dt
    if (this.accessTimer >= ACCESS_CHECK_SECONDS) {
      this.accessTimer = 0
      void this.checkAccess()
    }
  }

  /** a player whose sign-in is no longer allowed is sent back to the lobby with the reason */
  async checkAccess(): Promise<void> {
    const seats = [...this.seats.values()].filter(s => s.avatar)
    if (seats.length === 0) return
    const problems = await this.store.accessProblems(seats).catch(() => seats.map(() => null))
    seats.forEach((seat, i) => {
      const problem = problems[i]
      if (!problem || !this.seats.has(seat.peer.id)) return
      this.sendState(seat.peer, problem)
      this.send(seat.peer, { t: 'bye' })
      seat.peer.close()
      this.disconnect(seat.peer)
      // someone who may not play does not get their spot kept either
      this.held.delete(seat.userId)
    })
  }

  // ================================================================ saving, resetting, closing
  /** save as soon as any upload in flight is done; failures are retried by the autosave clock */
  private saveSoon(): void {
    this.autosave.markDirty()
    this.autosave.saveNow().catch(() => {})
  }

  saveNow(): Promise<void> {
    this.autosave.markDirty()
    return this.autosave.saveNow()
  }

  /**
   * Everyone out, with `reason`: the PC is handing the world to the browsers, shutting
   * down, or starting over. The world is saved first unless it is being thrown away.
   */
  async close(reason: string, opts: { save?: boolean } = {}): Promise<void> {
    if (this.closed) return
    // closed first: whatever goes wrong below, nothing feeds this room again
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.kickEveryone(reason)
    if (opts.save !== false) await this.saveNow().catch(() => {})
  }

  /** the admin reset the global world: everyone out, and a fresh world from here on (nothing of the old one is saved) */
  reset(fresh: HostSim, reason: string): void {
    this.kickEveryone(reason)
    this.held.clear()
    this.sim = fresh
    this.wire(fresh)
    this.signature = ''
    this.autosave = this.makeAutosave()
    this.autosave.markDirty()
  }

  private kickEveryone(reason: string): void {
    for (const seat of [...this.seats.values()]) {
      try {
        this.sendState(seat.peer, reason)
        this.send(seat.peer, { t: 'bye' })
        seat.peer.close()
        if (seat.avatar) this.sim.removePlayer(seat.avatar.id)
      } catch (err) {
        this.log.error('sending a player off failed', { err: String(err) })
      }
    }
    this.seats.clear()
  }

  private makeAutosave(): Autosave {
    return new Autosave(() => this.store.saveWorld(this.sim.buildSave(), this.sim.dayNight.night))
  }

  private wire(sim: HostSim): void {
    sim.onRun = run => { this.store.recordRun(run).catch(() => {}) }
    sim.onDawn = () => { this.saveSoon() }
  }

  // ================================================================ sending
  private send(peer: Peer, msg: HostMessage): void {
    peer.send(encode(msg))
  }

  private sendState(peer: Peer, message: string): void {
    this.send(peer, { t: 'state', message })
  }

  private broadcast(msg: HostMessage): void {
    const bytes = encode(msg)
    for (const seat of this.seats.values()) if (seat.avatar) seat.peer.send(bytes)
  }
}
