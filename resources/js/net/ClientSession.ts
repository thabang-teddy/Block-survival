/**
 * Client side of a match: connects to a host by room code, receives the welcome
 * (seed + world diff) before the Game is built, then streams inputs at INPUT_HZ and
 * applies snapshots / private state / block edits to the Game.
 *
 * With the host PC (docs/pc-host-research.md §5.4) a silence or a dropped link is a
 * pause, not the end: the session goes `paused` (the game freezes the player and the HUD
 * waits for the PC), and snapshots arriving again on the same link lift it.
 */
import { api } from './api'
import type { Game } from '../game/Game'
import { ClientTransport, type Link } from './transport'
import { SnapshotBuffer } from './SnapshotBuffer'
import { decode, encode, INPUT_HZ, PROTOCOL_VERSION, type ClientMessage, type HostMessage, type Welcome } from './protocol'

export type ClientStatus = 'connecting' | 'joined' | 'paused' | 'full' | 'host-left' | 'error'

/** who runs the world at the other end: the host PC, or another player's browser */
export type HostKind = 'pc' | 'browser'

/** a PC-hosted game that sends no snapshot for this long is paused (seconds) */
export const PAUSE_AFTER_SILENCE_SECONDS = 3

export class ClientSession {
  readonly role = 'client' as const
  readonly code: string
  readonly buffer = new SnapshotBuffer()
  welcome: Welcome | null = null
  status: ClientStatus = 'connecting'
  error = ''
  onStatus: ((status: ClientStatus) => void) | null = null
  private transport: ClientTransport | null = null
  private link: Link | null = null
  private game: Game | null = null
  private inputTimer = 0
  private welcomeResolve: ((w: Welcome) => void) | null = null
  private welcomeReject: ((e: Error) => void) | null = null

  private readonly name: string
  readonly hostKind: HostKind
  /** performance.now() of the last snapshot, in seconds */
  private lastSnapAt = 0
  private readonly clock: () => number

  constructor(code: string, name: string, hostKind: HostKind = 'browser', clock: () => number = () => performance.now() / 1000) {
    this.code = code
    this.name = name
    this.hostKind = hostKind
    this.clock = clock
  }

  /** the host PC went quiet: the game holds still until it is back */
  get paused(): boolean {
    return this.status === 'paused'
  }

  /** Connect and wait for the welcome; the Game is created from it afterwards. */
  connect(): Promise<Welcome> {
    return new Promise<Welcome>((resolve, reject) => {
      this.welcomeResolve = resolve
      this.welcomeReject = reject
      this.transport = new ClientTransport({
        onOpen: link => {
          this.link = link
          link.send(encode({ t: 'hello', v: PROTOCOL_VERSION, name: this.name, userId: api.user?.id }))
        },
        onData: (_link, bytes) => this.onData(bytes),
        onClose: () => this.onClose(),
      })
      this.transport.connect(this.code).catch(err => this.fail(err instanceof Error ? err.message : String(err)))
    })
  }

  attach(game: Game): void {
    this.game = game
  }

  send(msg: ClientMessage): void {
    this.link?.send(encode(msg))
  }

  tick(dt: number): void {
    const game = this.game
    if (this.status === 'joined' && this.hostKind === 'pc' && this.clock() - this.lastSnapAt > PAUSE_AFTER_SILENCE_SECONDS) {
      this.setStatus('paused')
    }
    // paused: nothing is sent — the world is not moving, so neither are we
    if (!game || !this.link || this.paused) return
    this.inputTimer += dt
    if (this.inputTimer < 1 / INPUT_HZ) return
    this.inputTimer = 0
    const a = game.local
    this.send({ t: 'input', x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: a.pitch, anim: a.anim, slot: a.slot, aiming: a.aiming })
  }

  dispose(): void {
    this.transport?.dispose()
    this.transport = null
    this.link = null
  }

  private setStatus(s: ClientStatus): void {
    this.status = s
    this.onStatus?.(s)
  }

  private fail(message: string): void {
    this.error = message
    this.setStatus('error')
    this.welcomeReject?.(new Error(message))
    this.welcomeReject = null
    this.welcomeResolve = null
  }

  private onClose(): void {
    this.link = null
    if (!this.welcome) {
      if (this.status === 'connecting') this.setStatus('error')
      this.fail('Connection closed before the game could start')
      return
    }
    // the host PC dropped out: paused until it is back (the HUD rejoins); a browser host is gone for good
    if (this.hostKind === 'pc' && (this.status === 'joined' || this.status === 'paused')) this.setStatus('paused')
    else if (this.status === 'joined') this.setStatus('host-left')
  }

  private onData(bytes: Uint8Array): void {
    let msg: HostMessage
    try {
      msg = decode<HostMessage>(bytes)
    } catch {
      return
    }
    switch (msg.t) {
      case 'welcome':
        this.welcome = msg
        this.lastSnapAt = this.clock()
        this.setStatus('joined')
        this.welcomeResolve?.(msg)
        this.welcomeResolve = null
        this.welcomeReject = null
        break
      case 'full':
        this.fail('That game is full')
        break
      case 'bye':
        this.setStatus('host-left')
        break
      case 'snap':
        this.buffer.push(msg, performance.now() / 1000)
        this.lastSnapAt = this.clock()
        // the PC froze the world and carried on over the same link
        if (this.status === 'paused' && this.link) this.setStatus('joined')
        break
      case 'state':
        this.game?.applyPrivateState(msg)
        break
      case 'blocks':
        this.game?.applyBlockEdits(msg.edits)
        break
      case 'chat':
        this.game?.showMessage(`${msg.from}: ${msg.text}`)
        break
    }
  }
}
