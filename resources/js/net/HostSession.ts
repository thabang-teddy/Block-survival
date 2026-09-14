/**
 * Host side of a match. Solo play is a HostSession with no transport ("host with zero
 * peers"). Accepts joiners, hands them the world diff, feeds their messages to the
 * authoritative Game and broadcasts snapshots at SNAPSHOT_HZ.
 */
import type { Game } from '../game/Game'
import { HostTransport, type Link } from './transport'
import {
  decode, encode, makeRoomCode, MAX_PLAYERS, PROTOCOL_VERSION, SNAPSHOT_HZ,
  type ClientMessage, type HostMessage, type Welcome,
} from './protocol'
import { api } from './api'

/** how often the host refreshes its room row on the API (seconds) */
const ROOM_REFRESH_SECONDS = 60

export class HostSession {
  readonly role = 'host' as const
  readonly code: string
  private transport: HostTransport | null = null
  private game: Game | null = null
  private snapshotTimer = 0
  /** links that connected but have not said hello yet */
  private readonly pending = new Set<string>()
  onPlayersChanged: (() => void) | null = null
  private roomRefreshTimer = 0

  constructor(code = makeRoomCode()) {
    this.code = code
  }

  attach(game: Game): void {
    this.game = game
  }

  get playerCount(): number {
    return this.game ? this.game.avatars.size : 1
  }

  get online(): boolean {
    return this.transport !== null
  }

  /**
   * Open the room: register the code → host id with the app so joiners can resolve
   * it, then start reading the room's mailbox (which 404s until the room exists).
   * Fails if the app cannot be reached.
   */
  async listen(hostName = 'Survivor'): Promise<void> {
    if (this.transport) return
    const t = new HostTransport({
      onOpen: link => { this.pending.add(link.id) },
      onData: (link, bytes) => this.onData(link, bytes),
      onClose: link => this.onLeave(link),
    })
    await api.createRoom(this.code, t.id, hostName)
    await t.listen(this.code)
    this.transport = t
  }

  tick(dt: number): void {
    const game = this.game
    if (!game || !this.transport) return
    this.roomRefreshTimer += dt
    if (this.roomRefreshTimer >= ROOM_REFRESH_SECONDS) {
      this.roomRefreshTimer = 0
      api.refreshRoom(this.code, this.transport.id, game.avatars.size).catch(() => {})
    }
    // block edits go out immediately, snapshots at a fixed rate, private state when dirty
    const edits = game.takeBlockEdits()
    if (edits.length) this.transport.broadcast(encode({ t: 'blocks', edits }))
    this.snapshotTimer += dt
    if (this.snapshotTimer >= 1 / SNAPSHOT_HZ) {
      this.snapshotTimer = 0
      this.transport.broadcast(encode(game.buildSnapshot()))
    }
    for (const avatar of game.avatars.values()) {
      if (avatar === game.local) continue
      const link = this.transport.links.get(avatar.id)
      if (!link) continue
      if (avatar.inventory.version !== avatar.inventoryVersionSent) {
        avatar.inventoryVersionSent = avatar.inventory.version
        avatar.push({ inventory: avatar.inventory.all() })
      }
      const state = avatar.takeOutbox()
      if (state) link.send(encode(state))
    }
  }

  dispose(): void {
    if (this.transport) {
      this.transport.broadcast(encode({ t: 'bye' }))
      api.closeRoom(this.code, this.transport.id).catch(() => {})
    }
    this.transport?.dispose()
    this.transport = null
  }

  private send(link: Link, msg: HostMessage): void {
    link.send(encode(msg))
  }

  private onData(link: Link, bytes: Uint8Array): void {
    const game = this.game
    if (!game) return
    let msg: ClientMessage
    try {
      msg = decode<ClientMessage>(bytes)
    } catch {
      return
    }
    if (this.pending.has(link.id)) {
      if (msg.t !== 'hello' || msg.v !== PROTOCOL_VERSION) return
      this.pending.delete(link.id)
      if (game.avatars.size >= MAX_PLAYERS) {
        this.send(link, { t: 'full' })
        link.close()
        return
      }
      const avatar = game.addRemoteAvatar(link.id, msg.name.slice(0, 16) || 'Player')
      const welcome: Welcome = {
        t: 'welcome', v: PROTOCOL_VERSION, you: avatar.id, seed: game.seed, time: game.dayNight.time,
        edits: game.worldEdits(), spawn: avatar.spawn,
      }
      this.send(link, welcome)
      avatar.push({ inventory: avatar.inventory.all(), magazine: 0, health: avatar.health })
      game.showMessage(`${avatar.name} joined`)
      this.onPlayersChanged?.()
      return
    }
    const avatar = game.avatars.get(link.id)
    if (!avatar) return
    game.applyClientMessage(avatar, msg)
  }

  private onLeave(link: Link): void {
    this.pending.delete(link.id)
    const game = this.game
    if (!game) return
    const avatar = game.avatars.get(link.id)
    if (avatar) {
      game.removeAvatar(link.id)
      game.showMessage(`${avatar.name} left`)
      this.onPlayersChanged?.()
    }
  }
}
