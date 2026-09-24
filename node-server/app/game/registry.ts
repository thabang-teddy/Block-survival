import { promisify } from 'node:util'
import { gzip as gzipCb, gunzipSync } from 'node:zlib'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import { HostSim, type Run } from '#game/sim/HostSim'
import { parseRules } from '#game/game/rules'
import { migrateSave } from '#game/net/saveMigrate'
import { makeRoomCode, MAX_PLAYERS } from '#game/net/limits'
import { GLOBAL_SEED, newWorldSeed } from '#game/world/seed'
import type { SaveData } from '#game/game/saveTypes'
import Device from '#models/device'
import Room from '#models/room'
import RoomSignal from '#models/room_signal'
import Score from '#models/score'
import User from '#models/user'
import World, { type WorldKind } from '#models/world'
import AccessPolicy from '#services/access_policy'
import { storeWorld } from '#services/world_store'
import GameRules from '#support/game_rules'
import { sqlTime } from '#support/time'
import { GameRoom, type Peer, type RoomStore } from '#game-server/game_room'
import { TicketBook, type Ticket } from '#game-server/tickets'

const gzip = promisify(gzipCb)

/** an empty room waits this long for someone to (re)connect before it saves and closes */
const EMPTY_GRACE_MS = 60_000
/** how often empty rooms are looked for */
const SWEEP_MS = 10_000

/** a request the registry turns down; `status` is the HTTP answer */
export class RoomRefusal extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/**
 * Every game this server runs, by room code: each player's own world (while anyone plays
 * in it) and the one shared global world. Opening a room loads its save and starts its
 * sim; a room nobody has been in for EMPTY_GRACE_MS saves and closes.
 */
export class RoomRegistry {
  private readonly rooms = new Map<string, GameRoom>()
  /** rooms being opened, so two requests at once share one */
  private readonly opening = new Map<string, Promise<GameRoom>>()
  readonly tickets = new TicketBook()
  private sweeper: ReturnType<typeof setInterval> | null = null

  running(code: string): GameRoom | undefined {
    const room = this.rooms.get(code.toUpperCase())
    return room && !room.isClosed ? room : undefined
  }

  ownRoomOf(userId: number): GameRoom | undefined {
    for (const room of this.rooms.values()) if (room.kind === 'own' && room.ownerId === userId && !room.isClosed) return room
    return undefined
  }

  globalRoom(): GameRoom | undefined {
    for (const room of this.rooms.values()) if (room.kind === 'global' && !room.isClosed) return room
    return undefined
  }

  /** who is in the shared global world right now (the lobby card and the admin) */
  presence(): { online: number; host_name: string | null } {
    const online = this.globalRoom()?.playerCount ?? 0
    return { online, host_name: online > 0 ? 'the server' : null }
  }

  /** the player's own world, opened on the server if it is not running yet */
  openOwn(user: User): Promise<Room> {
    const running = this.ownRoomOf(user.id)
    if (running) return this.rowOf(running)
    return this.open(`own:${user.id}`, async () => {
      const save = await this.loadSave(await World.ownOf(user.id), user.id)
      return { kind: 'own', ownerId: user.id, hostName: user.name, save, seed: newWorldSeed() }
    })
  }

  /** the shared global world, opened if nobody is in it */
  async openGlobal(): Promise<Room> {
    const running = this.globalRoom()
    if (running) {
      if (running.playerCount >= MAX_PLAYERS) throw new RoomRefusal('The global world is full right now — try again in a moment.', 409)
      return this.rowOf(running)
    }
    return this.open('global', async () => {
      const save = await this.loadSave(await World.global(), 0)
      return { kind: 'global', ownerId: null, hostName: 'Global world', save, seed: GLOBAL_SEED }
    })
  }

  issueTicket(user: User, code: string, deviceId: number | null): string {
    return this.tickets.issue({ userId: user.id, code: code.toUpperCase(), deviceId })
  }

  /** a socket presented a ticket: seat it in its room, or say why not */
  async admit(peer: Peer, ticketId: string | null): Promise<{ room: GameRoom } | { refusal: string }> {
    const ticket: Ticket | null = this.tickets.redeem(ticketId)
    if (!ticket) return { refusal: 'That link has expired — join again from the lobby.' }
    const user = await User.find(ticket.userId)
    if (!user) return { refusal: 'That account no longer exists.' }
    const room = this.running(ticket.code)
    if (!room) return { refusal: 'That game is over.' }
    room.connect(peer, { userId: user.id, name: user.name, deviceId: ticket.deviceId })
    return { room }
  }

  async close(code: string, reason: string, opts: { save?: boolean } = {}): Promise<void> {
    const room = this.rooms.get(code.toUpperCase())
    if (!room) return
    this.rooms.delete(room.code)
    await room.close(reason, opts)
  }

  async closeOwn(userId: number, reason: string, opts: { save?: boolean } = {}): Promise<void> {
    const room = this.ownRoomOf(userId)
    if (room) await this.close(room.code, reason, opts)
  }

  /** wipe the shared world; refused while someone is in it */
  async resetGlobal(): Promise<void> {
    const room = this.globalRoom()
    if (room && room.playerCount > 0) throw new RoomRefusal('Someone is in the global world — reset it when it is empty.', 409)
    if (room) await this.close(room.code, 'The global world was reset.', { save: false })
    await World.query().whereNull('user_id').where('kind', World.GLOBAL).delete()
  }

  /** start closing rooms that stay empty */
  startSweeping(): void {
    if (this.sweeper) return
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_MS)
    this.sweeper.unref()
  }

  async sweep(now = Date.now()): Promise<void> {
    for (const room of [...this.rooms.values()]) {
      if (room.emptySince !== null && now - room.emptySince >= EMPTY_GRACE_MS) {
        await this.close(room.code, 'Everyone left.')
      }
    }
  }

  /** the process is going down: save every world */
  async shutdown(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper)
    this.sweeper = null
    await Promise.all([...this.rooms.keys()].map((code) => this.close(code, 'The server is restarting — join again in a moment.')))
  }

  // ---------------------------------------------------------------- internals
  private async open(
    key: string,
    load: () => Promise<{ kind: WorldKind; ownerId: number | null; hostName: string; save: SaveData | null; seed: number }>
  ): Promise<Room> {
    let pending = this.opening.get(key)
    if (!pending) {
      pending = load()
        .then((o) => this.create(o))
        .finally(() => this.opening.delete(key))
      this.opening.set(key, pending)
    }
    return this.rowOf(await pending)
  }

  private async create(o: { kind: WorldKind; ownerId: number | null; hostName: string; save: SaveData | null; seed: number }): Promise<GameRoom> {
    const code = await this.freeCode()
    const rules = parseRules((await GameRules.fromSettings()).toJSON())
    const sim = new HostSim({ seed: o.seed, rules, restore: o.save ?? undefined, ownerId: o.ownerId })
    await Room.create({
      code,
      hostPeerId: Room.SERVER_HOST,
      userId: o.ownerId,
      hostName: o.hostName.slice(0, 16),
      worldKind: o.kind,
      players: 1,
      expiresAt: Room.freshExpiry(),
    })
    const room = new GameRoom(code, o.kind, o.ownerId, sim, this.storeFor(code, o.kind, o.ownerId), Date.now, o.save === null)
    this.rooms.set(code, room)
    room.start()
    logger.info({ code, kind: o.kind, ownerId: o.ownerId }, 'room opened')
    return room
  }

  private async rowOf(room: GameRoom): Promise<Room> {
    return Room.findByOrFail('code', room.code)
  }

  /** a code no live room (of this server or a peer-to-peer host) holds */
  private async freeCode(): Promise<string> {
    for (;;) {
      const code = makeRoomCode()
      if (this.rooms.has(code)) continue
      const row = await Room.findBy('code', code)
      if (!row) return code
      if (row.expiresAt <= DateTime.now()) {
        await RoomSignal.query().where('room_code', code).delete()
        await row.delete()
        return code
      }
    }
  }

  private async loadSave(world: World | null, ownerId: number): Promise<SaveData | null> {
    if (!world) return null
    try {
      return migrateSave(JSON.parse(gunzipSync(world.bytes()).toString('utf8')), ownerId)
    } catch (error) {
      logger.error({ err: error, world: world.id }, 'unreadable save; starting the world fresh')
      return null
    }
  }

  private storeFor(code: string, kind: WorldKind, ownerId: number | null): RoomStore {
    return {
      async saveWorld(save, night) {
        const bytes = await gzip(JSON.stringify(save))
        const result = await storeWorld(kind === 'global' ? null : ownerId, kind, bytes, night, save.time)
        if ('error' in result) throw new Error(result.error)
      },
      async recordRun(run: Run) {
        if (!(await User.find(run.userId))) return
        await Score.create({ ...run, score: Score.compute(run.nights, run.kills) })
      },
      async refreshRow(players) {
        await Room.query().where('code', code).update({ players, expires_at: sqlTime(Room.freshExpiry()) })
      },
      async removeRow() {
        await Room.query().where('code', code).delete()
      },
      async accessProblem(userId, deviceId) {
        const user = await User.find(userId)
        if (!user) return 'That account no longer exists.'
        const reason = await AccessPolicy.blockedReason(user)
        if (reason) return reason
        const device = deviceId === null ? null : await Device.find(deviceId)
        return AccessPolicy.deviceAllowed(user, device) ? null : 'This PC is waiting for admin approval.'
      },
    }
  }
}

const rooms = new RoomRegistry()
export default rooms
