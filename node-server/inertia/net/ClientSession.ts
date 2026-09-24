/**
 * This player's link to a game the server runs: a WebSocket opened with the one-time
 * ticket the API handed out, the welcome (seed + world diff) that arrives before the
 * Game is built, then inputs out at INPUT_HZ and snapshots / private state / block
 * edits in.
 */
import type { Game } from '../game/Game'
import { SnapshotBuffer } from './SnapshotBuffer'
import { decode, encode, INPUT_HZ, PROTOCOL_VERSION, type ClientMessage, type HostMessage, type Welcome } from './protocol'

/**
 * `closed`: the server ended the game for this player (the room closed, an admin, a
 * second tab) — `error` then holds its reason. `error` alone: the connection dropped.
 */
export type ClientStatus = 'connecting' | 'joined' | 'full' | 'closed' | 'error'

/** the game socket lives on the page's own origin */
export function socketUrl(ticket: string, location: Pick<Location, 'protocol' | 'host'> = window.location): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${location.host}/ws?ticket=${encodeURIComponent(ticket)}`
}

export class ClientSession {
  readonly role = 'client' as const
  readonly code: string
  readonly buffer = new SnapshotBuffer()
  welcome: Welcome | null = null
  status: ClientStatus = 'connecting'
  error = ''
  onStatus: ((status: ClientStatus) => void) | null = null
  private socket: WebSocket | null = null
  private game: Game | null = null
  private inputTimer = 0
  /** the last message the server sent before a welcome or a goodbye: its reason */
  private lastMessage = ''
  private welcomeResolve: ((w: Welcome) => void) | null = null
  private welcomeReject: ((e: Error) => void) | null = null
  private readonly name: string
  private readonly ticket: string

  constructor(code: string, name: string, ticket: string) {
    this.code = code
    this.name = name
    this.ticket = ticket
  }

  /** Open the socket and wait for the welcome; the Game is created from it afterwards. */
  connect(url = socketUrl(this.ticket)): Promise<Welcome> {
    return new Promise<Welcome>((resolve, reject) => {
      this.welcomeResolve = resolve
      this.welcomeReject = reject
      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => ws.send(encode({ t: 'hello', v: PROTOCOL_VERSION, name: this.name }))
      ws.onmessage = ev => this.onData(ev.data as ArrayBuffer)
      ws.onclose = () => this.onClose()
      this.socket = ws
    })
  }

  attach(game: Game): void {
    this.game = game
  }

  send(msg: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(encode(msg))
  }

  tick(dt: number): void {
    const game = this.game
    if (!game || this.status !== 'joined') return
    this.inputTimer += dt
    if (this.inputTimer < 1 / INPUT_HZ) return
    this.inputTimer = 0
    const a = game.local
    this.send({ t: 'input', x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: a.pitch, anim: a.anim, slot: a.slot, aiming: a.aiming })
  }

  /** leave: the server keeps the world (and saves what this player carried) */
  dispose(): void {
    const ws = this.socket
    this.socket = null
    if (!ws) return
    ws.onclose = null
    ws.close()
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
    this.socket = null
    if (!this.welcome) {
      this.fail(this.lastMessage || 'Could not reach the game server')
      return
    }
    if (this.status === 'joined') {
      this.error = this.lastMessage || 'The connection to the server dropped.'
      this.setStatus('error')
    }
  }

  private onData(bytes: ArrayBuffer): void {
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
        this.error = this.lastMessage || 'The game is over.'
        if (this.welcome) this.setStatus('closed')
        break
      case 'snap':
        this.buffer.push(msg, performance.now() / 1000)
        break
      case 'state':
        if (msg.message) this.lastMessage = msg.message
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
