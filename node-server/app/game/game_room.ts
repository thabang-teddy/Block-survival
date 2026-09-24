import { HostSim, type Run } from '#game/sim/HostSim'
import { validateClientMessage } from '#game/sim/validate'
import { decode, encode, MAX_PLAYERS, PROTOCOL_VERSION, SNAPSHOT_HZ, type HostMessage } from '#game/net/protocol'
import { Autosave } from '#game/game/autosave'
import type { Avatar } from '#game/game/Avatar'
import type { SaveData } from '#game/game/saveTypes'
import type { WorldKind } from '#models/world'

/** one player's connection, as the room sees it (a WebSocket in production, a fake in tests) */
export interface Peer {
  readonly id: string
  send(bytes: Uint8Array): void
  close(): void
}

/** what the room needs from the rest of the app: the database, and the access gates */
export interface RoomStore {
  saveWorld(save: SaveData, night: number): Promise<void>
  recordRun(run: Run): Promise<void>
  /** keep the room's row alive (TTL) and its player count current */
  refreshRow(players: number): Promise<void>
  removeRow(): Promise<void>
  /** why this player may no longer play (account disabled, window closed, device revoked), or null */
  accessProblem(userId: number, deviceId: number | null): Promise<string | null>
}

export interface Player {
  userId: number
  name: string
  deviceId: number | null
}

interface Seat extends Player {
  peer: Peer
  /** null until the client's hello */
  avatar: Avatar | null
  /** messages received in the current one-second window */
  received: number
}

export const TICK_HZ = 30
/** the row's TTL and player count are refreshed this often (seconds) */
const ROW_REFRESH_SECONDS = 15
/** connected players are re-checked against the access gates this often (seconds) */
const ACCESS_CHECK_SECONDS = 30
/** inputs at 30 Hz plus actions; a client sending more than this in a second is dropped */
const MAX_MESSAGES_PER_SECOND = 240

/**
 * One running game: a HostSim ticked at TICK_HZ, the players connected to it, and its
 * saving. Players send validated ClientMessages; everyone gets snapshots, block edits
 * and their private state back. The world saves on the autosave clock when something
 * changed, at dawn, when a player leaves, when its owner asks, and when it closes.
 */
export class GameRoom {
  readonly sim: HostSim
  private readonly seats = new Map<string, Seat>()
  private readonly autosave: Autosave
  private timer: ReturnType<typeof setInterval> | null = null
  private lastTick = 0
  private snapshotTimer = 0
  private rowTimer = 0
  private accessTimer = 0
  private rateTimer = 0
  private signature = ''
  private closed = false
  /** when the last player left (ms), or null while someone is here */
  emptySince: number | null

  constructor(
    readonly code: string,
    readonly kind: WorldKind,
    /** the account whose own world this is (null: the global world) */
    readonly ownerId: number | null,
    sim: HostSim,
    private readonly store: RoomStore,
    private readonly now: () => number = Date.now,
    /** a brand-new world is saved once straight away so its seed sticks */
    fresh = false
  ) {
    this.sim = sim
    this.emptySince = now()
    this.autosave = new Autosave(() => this.store.saveWorld(this.sim.buildSave(), this.sim.dayNight.night))
    if (fresh) this.autosave.markDirty()
    sim.onRun = (run) => { this.store.recordRun(run).catch(() => {}) }
    sim.onDawn = () => { this.saveSoon() }
  }

  get playerCount(): number {
    let n = 0
    for (const s of this.seats.values()) if (s.avatar) n++
    return n
  }

  get isClosed(): boolean {
    return this.closed
  }

  start(): void {
    if (this.timer) return
    this.lastTick = this.now()
    this.timer = setInterval(() => {
      const t = this.now()
      this.tick((t - this.lastTick) / 1000)
      this.lastTick = t
    }, 1000 / TICK_HZ)
  }

  // ================================================================ connections
  /** a socket arrived with a valid ticket; the player joins once it says hello */
  connect(peer: Peer, player: Player): void {
    if (this.closed) {
      this.send(peer, { t: 'bye' })
      peer.close()
      return
    }
    // one seat per account: a second tab replaces the first
    for (const seat of this.seats.values()) {
      if (seat.userId !== player.userId) continue
      this.sendState(seat.peer, 'You joined this game from somewhere else.')
      this.send(seat.peer, { t: 'bye' })
      seat.peer.close()
      this.disconnect(seat.peer)
    }
    this.seats.set(peer.id, { ...player, name: player.name.slice(0, 16) || 'Survivor', peer, avatar: null, received: 0 })
  }

  receive(peer: Peer, bytes: Uint8Array): void {
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
    if (msg.t === 'save') {
      // the owner of an own world (anyone, in the global one) may ask for a save
      if (this.ownerId === null || seat.userId === this.ownerId) {
        this.autosave.saveNow().then(
          () => this.sendState(seat.peer, 'World saved'),
          () => this.sendState(seat.peer, 'Saving failed — the server will try again')
        )
      }
      return
    }
    this.sim.apply(seat.avatar, msg)
  }

  disconnect(peer: Peer): void {
    const seat = this.seats.get(peer.id)
    if (!seat) return
    this.seats.delete(peer.id)
    if (!seat.avatar) return
    this.sim.removePlayer(seat.avatar.id)
    this.sim.broadcastMessage(`${seat.avatar.name} left`)
    // what they carried goes into the save now, not a minute from now
    this.saveSoon()
    if (this.playerCount === 0) this.emptySince = this.now()
  }

  private hello(seat: Seat, version: number): void {
    if (version !== PROTOCOL_VERSION) {
      this.sendState(seat.peer, 'This page is out of date — reload it to play.')
      this.send(seat.peer, { t: 'bye' })
      seat.peer.close()
      this.seats.delete(seat.peer.id)
      return
    }
    if (this.playerCount >= MAX_PLAYERS) {
      this.send(seat.peer, { t: 'full' })
      seat.peer.close()
      this.seats.delete(seat.peer.id)
      return
    }
    const avatar = this.sim.addPlayer(seat.peer.id, seat.name, seat.userId)
    seat.avatar = avatar
    this.emptySince = null
    this.send(seat.peer, this.sim.welcome(avatar))
    this.send(seat.peer, this.sim.initialState(avatar))
    this.sim.broadcastMessage(`${avatar.name} joined`)
  }

  // ================================================================ tick
  tick(dt: number): void {
    if (this.closed) return
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

    this.rateTimer += dt
    if (this.rateTimer >= 1) {
      this.rateTimer = 0
      for (const seat of this.seats.values()) seat.received = 0
    }
    this.tickSaving(dt)
    this.tickHousekeeping(dt)
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
    this.rowTimer += dt
    if (this.rowTimer >= ROW_REFRESH_SECONDS) {
      this.rowTimer = 0
      this.store.refreshRow(Math.max(1, this.playerCount)).catch(() => {})
    }
    this.accessTimer += dt
    if (this.accessTimer >= ACCESS_CHECK_SECONDS) {
      this.accessTimer = 0
      void this.checkAccess()
    }
  }

  /** a player whose sign-in is no longer allowed is sent back to the lobby with the reason */
  async checkAccess(): Promise<void> {
    for (const seat of [...this.seats.values()]) {
      const problem = await this.store.accessProblem(seat.userId, seat.deviceId).catch(() => null)
      if (!problem || !this.seats.has(seat.peer.id)) continue
      this.sendState(seat.peer, problem)
      this.send(seat.peer, { t: 'bye' })
      seat.peer.close()
      this.disconnect(seat.peer)
    }
  }

  // ================================================================ saving and closing
  /** save as soon as any upload in flight is done; failures are retried by the autosave clock */
  private saveSoon(): void {
    this.autosave.markDirty()
    this.autosave.saveNow().catch(() => {})
  }

  saveNow(): Promise<void> {
    return this.autosave.saveNow()
  }

  /**
   * Stop the room: everyone is sent back to the lobby with `reason`, the world is saved
   * (unless it is being thrown away) and the room's row goes.
   */
  async close(reason: string, opts: { save?: boolean } = {}): Promise<void> {
    if (this.closed) return
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const seat of [...this.seats.values()]) {
      this.sendState(seat.peer, reason)
      this.send(seat.peer, { t: 'bye' })
      seat.peer.close()
      if (seat.avatar) this.sim.removePlayer(seat.avatar.id)
    }
    this.seats.clear()
    this.closed = true
    if (opts.save !== false) {
      this.autosave.markDirty()
      await this.autosave.saveNow().catch(() => {})
    }
    await this.store.removeRow().catch(() => {})
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
