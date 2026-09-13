/**
 * WebRTC transport with signalling over Laravel Reverb. Offers, answers and ICE
 * candidates go through POST /api/rooms/{code}/signal and arrive on the room's
 * broadcast channel; once the handshake completes all traffic is peer-to-peer
 * over a reliable, ordered DataChannel carrying msgpackr bytes.
 */
import { api } from './api'
import { echo, socketId } from './echo'

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

interface SignalMessage {
  from: string
  to: string
  type: 'offer' | 'answer' | 'candidate'
  data: Record<string, unknown>
}

const CONNECT_TIMEOUT_MS = 15_000
const DATA_CHANNEL = 'game'
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
export function makePeerId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, b => ID_ALPHABET[b % ID_ALPHABET.length]).join('')
}

/** Subscription to a room's signalling channel plus the relay endpoint. */
class Signaller {
  private readonly code: string
  private readonly me: string
  private readonly channel: ReturnType<ReturnType<typeof echo>['channel']>
  private readonly handlers = new Set<(m: SignalMessage) => void>()
  /** resolves once the Reverb subscription is live, so no signal can be missed */
  readonly ready: Promise<void>

  constructor(code: string, me: string) {
    this.code = code
    this.me = me
    this.channel = echo().channel(`room.${code}`)
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Could not reach the signalling server')), CONNECT_TIMEOUT_MS)
      this.channel.subscribed(() => { clearTimeout(timer); resolve() })
      this.channel.error((err: unknown) => { clearTimeout(timer); reject(new Error(`Signalling error: ${String(err)}`)) })
    })
    this.channel.listen('.signal', (m: SignalMessage) => {
      if (m.to !== me) return
      for (const h of this.handlers) h(m)
    })
  }

  on(handler: (m: SignalMessage) => void): void {
    this.handlers.add(handler)
  }

  send(to: string, type: SignalMessage['type'], data: Record<string, unknown>): Promise<void> {
    return api.signal(this.code, { from: this.me, to, type, data }, socketId())
  }

  leave(): void {
    echo().leave(`room.${this.code}`)
  }
}

/** One peer connection: candidates are queued until the remote description is set. */
class Peer {
  readonly pc = new RTCPeerConnection(RTC_CONFIG)
  readonly remoteId: string
  private pending: RTCIceCandidateInit[] = []
  private remoteSet = false

  constructor(signaller: Signaller, remoteId: string) {
    this.remoteId = remoteId
    this.pc.onicecandidate = e => {
      if (e.candidate) void signaller.send(remoteId, 'candidate', e.candidate.toJSON() as Record<string, unknown>)
    }
  }

  async setRemote(desc: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(desc)
    this.remoteSet = true
    for (const c of this.pending) await this.pc.addIceCandidate(c).catch(() => {})
    this.pending = []
  }

  async addCandidate(c: RTCIceCandidateInit): Promise<void> {
    if (!this.remoteSet) { this.pending.push(c); return }
    await this.pc.addIceCandidate(c).catch(() => {})
  }
}

function wrap(peer: Peer, dc: RTCDataChannel, events: TransportEvents): Link {
  dc.binaryType = 'arraybuffer'
  const link: Link = {
    id: peer.remoteId,
    send: bytes => { if (dc.readyState === 'open') dc.send(bytes as Uint8Array<ArrayBuffer>) },
    close: () => { dc.close(); peer.pc.close() },
  }
  dc.onmessage = ev => {
    if (ev.data instanceof ArrayBuffer) events.onData(link, new Uint8Array(ev.data))
  }
  let closed = false
  const close = () => { if (!closed) { closed = true; events.onClose(link) } }
  dc.onclose = close
  peer.pc.onconnectionstatechange = () => {
    if (peer.pc.connectionState === 'failed' || peer.pc.connectionState === 'closed' || peer.pc.connectionState === 'disconnected') close()
  }
  return link
}

export class HostTransport {
  readonly id = makePeerId()
  readonly links = new Map<string, Link>()
  private signaller: Signaller | null = null
  private readonly peers = new Map<string, Peer>()
  private readonly events: TransportEvents

  constructor(events: TransportEvents) {
    this.events = events
  }

  /** Subscribe to the room channel and answer every offer that names us. */
  async listen(code: string): Promise<void> {
    const s = new Signaller(code, this.id)
    this.signaller = s
    s.on(m => { this.onSignal(s, m).catch((err: unknown) => console.error('signalling failed', m.type, err)) })
    await s.ready
  }

  private async onSignal(s: Signaller, m: SignalMessage): Promise<void> {
    let peer = this.peers.get(m.from)
    if (m.type === 'offer') {
      peer?.pc.close()
      peer = new Peer(s, m.from)
      this.peers.set(m.from, peer)
      peer.pc.ondatachannel = ev => {
        const link = wrap(peer!, ev.channel, {
          onOpen: () => {},
          onData: this.events.onData,
          onClose: l => { this.links.delete(l.id); this.peers.delete(l.id); this.events.onClose(l) },
        })
        ev.channel.onopen = () => {
          this.links.set(link.id, link)
          this.events.onOpen(link)
        }
      }
      await peer.setRemote(m.data as unknown as RTCSessionDescriptionInit)
      const answer = await peer.pc.createAnswer()
      await peer.pc.setLocalDescription(answer)
      await s.send(m.from, 'answer', { type: answer.type, sdp: answer.sdp })
    } else if (m.type === 'candidate' && peer) {
      await peer.addCandidate(m.data as RTCIceCandidateInit)
    }
  }

  broadcast(bytes: Uint8Array): void {
    for (const l of this.links.values()) l.send(bytes)
  }

  dispose(): void {
    for (const l of this.links.values()) l.close()
    this.links.clear()
    for (const p of this.peers.values()) p.pc.close()
    this.peers.clear()
    this.signaller?.leave()
    this.signaller = null
  }
}

export class ClientTransport {
  readonly id = makePeerId()
  link: Link | null = null
  private signaller: Signaller | null = null
  private peer: Peer | null = null
  private readonly events: TransportEvents

  constructor(events: TransportEvents) {
    this.events = events
  }

  /** Resolve the host through the rooms API, then offer it a DataChannel. */
  async connect(code: string): Promise<Link> {
    const { room } = await api.resolveRoom(code)
    const s = new Signaller(code, this.id)
    this.signaller = s
    await s.ready
    const peer = new Peer(s, room.host_peer_id)
    this.peer = peer
    const dc = peer.pc.createDataChannel(DATA_CHANNEL, { ordered: true })

    return new Promise<Link>((resolve, reject) => {
      const timer = setTimeout(() => {
        peer.pc.close()
        reject(new Error('Could not reach the host (is the game still open?)'))
      }, CONNECT_TIMEOUT_MS)
      const link = wrap(peer, dc, {
        onOpen: () => {},
        onData: this.events.onData,
        onClose: l => { this.link = null; this.events.onClose(l) },
      })
      dc.onopen = () => {
        clearTimeout(timer)
        this.link = link
        this.events.onOpen(link)
        resolve(link)
      }
      s.on(m => {
        const p = m.type === 'answer' ? peer.setRemote(m.data as unknown as RTCSessionDescriptionInit)
          : m.type === 'candidate' ? peer.addCandidate(m.data as RTCIceCandidateInit) : Promise.resolve()
        p.catch((err: unknown) => console.error('signalling failed', m.type, err))
      })
      void (async () => {
        const offer = await peer.pc.createOffer()
        await peer.pc.setLocalDescription(offer)
        await s.send(room.host_peer_id, 'offer', { type: offer.type, sdp: offer.sdp })
      })().catch(err => { clearTimeout(timer); reject(err instanceof Error ? err : new Error(String(err))) })
    })
  }

  dispose(): void {
    this.link?.close()
    this.link = null
    this.peer?.pc.close()
    this.peer = null
    this.signaller?.leave()
    this.signaller = null
  }
}
