/**
 * Thin PeerJS wrapper. The host registers its room code as its peer id on the public
 * PeerJS broker; clients connect to that id. After the WebRTC handshake all traffic
 * is peer-to-peer over a reliable DataChannel carrying msgpackr bytes.
 */
import Peer, { type DataConnection } from 'peerjs'
import { peerIdForRoom } from './protocol'

export interface Link {
  id: string
  send(bytes: Uint8Array): void
  close(): void
}

export interface TransportEvents {
  onOpen(link: Link): void
  onData(link: Link, bytes: Uint8Array): void
  onClose(link: Link): void
}

const CONNECT_TIMEOUT_MS = 12_000

const toBytes = (data: unknown): Uint8Array | null => {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return null
}

function wrap(conn: DataConnection, events: TransportEvents): Link {
  const link: Link = {
    id: conn.peer,
    send: bytes => { if (conn.open) conn.send(bytes) },
    close: () => conn.close(),
  }
  conn.on('data', data => {
    const bytes = toBytes(data)
    if (bytes) events.onData(link, bytes)
  })
  conn.on('close', () => events.onClose(link))
  conn.on('error', () => events.onClose(link))
  return link
}

/** Opens a Peer and resolves once the broker has accepted our id. */
function openPeer(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 })
    const timer = setTimeout(() => { peer.destroy(); reject(new Error('Could not reach the signalling server')) }, CONNECT_TIMEOUT_MS)
    peer.on('open', () => { clearTimeout(timer); resolve(peer) })
    peer.on('error', err => {
      clearTimeout(timer)
      peer.destroy()
      const type = (err as { type?: string }).type
      reject(new Error(type === 'unavailable-id' ? 'That room code is already in use' : type === 'peer-unavailable' ? 'No game with that code' : err.message))
    })
  })
}

export class HostTransport {
  private peer: Peer | null = null
  readonly links = new Map<string, Link>()
  private readonly events: TransportEvents

  constructor(events: TransportEvents) {
    this.events = events
  }

  async listen(code: string): Promise<void> {
    this.peer = await openPeer(peerIdForRoom(code))
    this.peer.on('connection', conn => {
      const link = wrap(conn, {
        onOpen: () => {},
        onData: this.events.onData,
        onClose: l => { this.links.delete(l.id); this.events.onClose(l) },
      })
      conn.on('open', () => {
        this.links.set(link.id, link)
        this.events.onOpen(link)
      })
    })
  }

  broadcast(bytes: Uint8Array): void {
    for (const l of this.links.values()) l.send(bytes)
  }

  dispose(): void {
    for (const l of this.links.values()) l.close()
    this.links.clear()
    this.peer?.destroy()
    this.peer = null
  }
}

export class ClientTransport {
  private peer: Peer | null = null
  link: Link | null = null
  private readonly events: TransportEvents

  constructor(events: TransportEvents) {
    this.events = events
  }

  async connect(code: string): Promise<Link> {
    this.peer = await openPeer()
    const conn = this.peer.connect(peerIdForRoom(code), { reliable: true, serialization: 'raw' })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No game with that code (timed out)')), CONNECT_TIMEOUT_MS)
      const link = wrap(conn, {
        onOpen: () => {},
        onData: this.events.onData,
        onClose: l => { this.link = null; this.events.onClose(l) },
      })
      conn.on('open', () => {
        clearTimeout(timer)
        this.link = link
        this.events.onOpen(link)
        resolve(link)
      })
      this.peer!.on('error', err => { clearTimeout(timer); reject(new Error((err as { type?: string }).type === 'peer-unavailable' ? 'No game with that code' : err.message)) })
    })
  }

  dispose(): void {
    this.link?.close()
    this.link = null
    this.peer?.destroy()
    this.peer = null
  }
}
