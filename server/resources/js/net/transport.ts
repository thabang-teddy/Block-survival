/**
 * WebRTC transport with signalling over plain HTTP. Offers, answers and ICE
 * candidates go through POST /api/rooms/{code}/signal into the room's mailbox
 * and each peer polls GET /api/rooms/{code}/signals for the ones addressed to
 * it — no socket server, so it runs on shared hosting. Once the handshake
 * completes all traffic is peer-to-peer over a reliable, ordered DataChannel
 * carrying msgpackr bytes.
 */
import { api, ApiError, type SignalRow } from './api'

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

export interface SignalMessage {
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

/** poll cadence: quick while a handshake is in flight, relaxed once the room is quiet */
export const POLL_ACTIVE_MS = 500
export const POLL_IDLE_MS = 1500
/** how long after the last signal the poller stays on the quick cadence */
export const POLL_ACTIVE_WINDOW_MS = 10_000
/** a failed poll backs off this much more each time (capped) so an outage does not hammer the server */
const POLL_ERROR_STEP_MS = 1000
const POLL_ERROR_MAX_MS = 5000
/** the server's page size; a full page means more is probably waiting */
const POLL_PAGE = 50
/** a send that fails on the network or with a 5xx is retried this many more times */
const SEND_RETRIES = 2
const SEND_RETRY_MS = 300

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
export function makePeerId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, b => ID_ALPHABET[b % ID_ALPHABET.length]).join('')
}

export interface SignallerOptions {
  /** true = always poll at the active cadence (a joining client, which stops as soon as it connects) */
  alwaysActive?: boolean
  /** injectable clock for tests */
  now?: () => number
}

/**
 * A peer's mailbox in one room: sends go straight to the API, receives come
 * from a polling loop that advances an id cursor so nothing is delivered twice.
 * Delivery order is the server's insertion order, so an offer always precedes
 * its candidates.
 */
export class Signaller {
  private readonly code: string
  private readonly me: string
  private readonly handlers = new Set<(m: SignalMessage) => void>()
  private readonly alwaysActive: boolean
  private readonly now: () => number
  private cursor = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight = false
  private stopped = false
  private lastSignalAt = -Infinity
  private errorBackoff = 0
  /**
   * The last poll found no live room (404). Polling continues at the error
   * backoff — a host's TTL refresh can bring the room back — but a joiner's
   * connect timeout reports this instead of a generic failure.
   */
  gone: Error | null = null

  constructor(code: string, me: string, opts: SignallerOptions = {}) {
    this.code = code
    this.me = me
    this.alwaysActive = opts.alwaysActive ?? false
    this.now = opts.now ?? (() => Date.now())
  }

  on(handler: (m: SignalMessage) => void): void {
    this.handlers.add(handler)
  }

  /** Post one message to `to`; a lost offer or answer is a failed join, so transient errors are retried. */
  async send(to: string, type: SignalMessage['type'], data: Record<string, unknown>): Promise<void> {
    const msg = { from: this.me, to, type, data }
    for (let attempt = 0; ; attempt++) {
      try {
        await api.signal(this.code, msg)
        return
      } catch (err) {
        const transient = err instanceof ApiError && (err.status === 0 || err.status >= 500)
        if (!transient || attempt >= SEND_RETRIES) throw err
        await new Promise(r => setTimeout(r, SEND_RETRY_MS * (attempt + 1)))
      }
    }
  }

  /** Begin polling. The first poll is immediate; later ones follow the cadence above. */
  start(): void {
    if (this.stopped || this.timer !== null || this.inFlight) return
    this.schedule(0)
  }

  /** Stop polling; a poll already in flight is dropped when it lands. */
  leave(): void {
    this.stopped = true
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null }
  }

  /** the delay before the next poll, given what has happened lately */
  private delay(): number {
    if (this.errorBackoff > 0) return this.errorBackoff
    if (this.alwaysActive) return POLL_ACTIVE_MS
    return this.now() - this.lastSignalAt < POLL_ACTIVE_WINDOW_MS ? POLL_ACTIVE_MS : POLL_IDLE_MS
  }

  private schedule(ms: number): void {
    if (this.stopped) return
    this.timer = setTimeout(() => { this.timer = null; void this.poll() }, ms)
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.inFlight) return
    this.inFlight = true
    let rows: SignalRow[] = []
    try {
      rows = (await api.signals(this.code, this.me, this.cursor)).signals
      this.errorBackoff = 0
      this.gone = null
    } catch (err) {
      this.gone = err instanceof ApiError && err.status === 404 ? new Error('The game is no longer open.') : null
      this.errorBackoff = Math.min(this.errorBackoff + POLL_ERROR_STEP_MS, POLL_ERROR_MAX_MS)
    } finally {
      this.inFlight = false
    }
    if (this.stopped) return
    if (rows.length > 0) this.lastSignalAt = this.now()
    for (const r of rows) {
      this.cursor = Math.max(this.cursor, r.id)
      const m: SignalMessage = { from: r.from, to: this.me, type: r.type, data: r.data }
      for (const h of this.handlers) h(m)
    }
    this.schedule(rows.length >= POLL_PAGE ? 0 : this.delay())
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

  /** Open the room's mailbox and answer every offer that names us. */
  async listen(code: string): Promise<void> {
    const s = new Signaller(code, this.id)
    this.signaller = s
    s.on(m => { this.onSignal(s, m).catch((err: unknown) => console.error('signalling failed', m.type, err)) })
    s.start()
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
    const s = new Signaller(code, this.id, { alwaysActive: true })
    this.signaller = s
    const peer = new Peer(s, room.host_peer_id)
    this.peer = peer
    const dc = peer.pc.createDataChannel(DATA_CHANNEL, { ordered: true })

    return new Promise<Link>((resolve, reject) => {
      const timer = setTimeout(() => {
        peer.pc.close()
        s.leave()
        reject(s.gone ?? new Error('Could not reach the host (is the game still open?)'))
      }, CONNECT_TIMEOUT_MS)
      const link = wrap(peer, dc, {
        onOpen: () => {},
        onData: this.events.onData,
        onClose: l => { this.link = null; this.events.onClose(l) },
      })
      dc.onopen = () => {
        clearTimeout(timer)
        // connected: the mailbox has done its job, stop polling
        s.leave()
        this.link = link
        this.events.onOpen(link)
        resolve(link)
      }
      s.on(m => {
        const p = m.type === 'answer' ? peer.setRemote(m.data as unknown as RTCSessionDescriptionInit)
          : m.type === 'candidate' ? peer.addCandidate(m.data as RTCIceCandidateInit) : Promise.resolve()
        p.catch((err: unknown) => console.error('signalling failed', m.type, err))
      })
      s.start()
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
