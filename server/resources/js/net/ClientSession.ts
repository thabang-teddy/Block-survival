/**
 * Client side of a match: connects to a host by room code, receives the welcome
 * (seed + world diff) before the Game is built, then streams inputs at INPUT_HZ and
 * applies snapshots / private state / block edits to the Game.
 */
import { api } from './api'
import type { Game } from '../game/Game'
import { ClientTransport, type Link } from './transport'
import { SnapshotBuffer } from './SnapshotBuffer'
import { decode, encode, INPUT_HZ, PROTOCOL_VERSION, type ClientMessage, type HostMessage, type Welcome } from './protocol'

export type ClientStatus = 'connecting' | 'joined' | 'full' | 'host-left' | 'error'

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

  constructor(code: string, name: string) {
    this.code = code
    this.name = name
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
    if (!game || !this.link) return
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
    if (this.status === 'joined' || this.status === 'connecting') this.setStatus(this.welcome ? 'host-left' : 'error')
    if (!this.welcome) this.fail('Connection closed before the game could start')
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
