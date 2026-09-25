/**
 * The PC's end of the WebRTC path (docs/pc-host-research.md §3.1, §5.2): the browser's
 * HostTransport and Signaller (server/resources/js/net/transport.ts) ported to Node,
 * with node-datachannel's RTCPeerConnection. Offers come from the global room's mailbox,
 * each carrying the identity the site vouched for; answers and candidates go back
 * through it. Once a DataChannel is open, play is peer-to-peer as it is between
 * browsers: DTLS, one reliable ordered channel, msgpack.
 */
import type { HostSignal, IceServer, Site } from '../site'
import type { Player } from '../room/GameRoom'

export interface Link {
  readonly id: string
  send(bytes: Uint8Array): void
  close(): void
}

export interface HostTransportEvents {
  /** a DataChannel opened for a player the site vouched for */
  onOpen(link: Link, player: Player): void
  onData(link: Link, bytes: Uint8Array): void
  onClose(link: Link): void
}

/** the slice of RTCPeerConnection the transport uses, so tests can bring their own */
export type PeerConnectionFactory = (config: PeerConfig) => RTCPeerConnection

export interface PeerConfig extends RTCConfiguration {
  /** node-datachannel: the UDP ports ICE may use (forward them on the router, or not) */
  portRangeBegin?: number
  portRangeEnd?: number
}

export interface TransportOptions {
  iceServers: IceServer[]
  portRange?: [number, number]
  /** relay-only ICE: players never see the PC's own address */
  relayOnly?: boolean
  now?: () => number
}

/** mailbox cadence: quick while a join is in flight, relaxed once the room is quiet */
export const POLL_ACTIVE_MS = 500
export const POLL_IDLE_MS = 1000
export const POLL_ACTIVE_WINDOW_MS = 10_000
const POLL_ERROR_MAX_MS = 5000
const POLL_PAGE = 50
/** a player whose channel has not opened by then is given up on */
const CONNECT_TIMEOUT_MS = 20_000

/** what the heartbeat reports, so ICE trouble can be measured (docs/pc-host-research.md §4) */
export interface TransportStats {
  opened: number
  failed: number
  /** the local candidate type each opened connection settled on */
  types: Record<string, number>
}

interface PeerEntry {
  pc: RTCPeerConnection
  player: Player
  pending: RTCIceCandidateInit[]
  remoteSet: boolean
  opened: boolean
  timer: ReturnType<typeof setTimeout>
}

/** Polls the global room's mailbox for the PC, advancing an id cursor so nothing is delivered twice. */
export class Mailbox {
  private cursor = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = true
  private lastSignalAt = -Infinity
  private errorBackoff = 0

  constructor(
    private readonly site: Site,
    private readonly handle: (row: HostSignal) => void,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.schedule(0)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** a new room (new code) means a new mailbox: start reading it from the beginning */
  reset(): void {
    this.cursor = 0
  }

  private schedule(ms: number): void {
    if (this.stopped) return
    this.timer = setTimeout(() => { this.timer = null; void this.poll() }, ms)
  }

  private async poll(): Promise<void> {
    let rows: HostSignal[] = []
    try {
      rows = await this.site.signals(this.cursor)
      this.errorBackoff = 0
    } catch {
      this.errorBackoff = Math.min(this.errorBackoff + 1000, POLL_ERROR_MAX_MS)
    }
    if (this.stopped) return
    if (rows.length > 0) this.lastSignalAt = this.now()
    for (const r of rows) {
      this.cursor = Math.max(this.cursor, r.id)
      this.handle(r)
    }
    const quick = this.now() - this.lastSignalAt < POLL_ACTIVE_WINDOW_MS
    this.schedule(rows.length >= POLL_PAGE ? 0 : this.errorBackoff || (quick ? POLL_ACTIVE_MS : POLL_IDLE_MS))
  }
}

export class HostTransport {
  readonly links = new Map<string, Link>()
  readonly stats: TransportStats = { opened: 0, failed: 0, types: {} }
  private readonly peers = new Map<string, PeerEntry>()
  private readonly mailbox: Mailbox
  private options: TransportOptions

  constructor(
    private readonly site: Site,
    private readonly events: HostTransportEvents,
    private readonly makePeer: PeerConnectionFactory,
    options: TransportOptions,
    private readonly onError: (msg: string, err: unknown) => void = () => {},
  ) {
    this.options = options
    this.mailbox = new Mailbox(site, row => { this.onSignal(row).catch(err => this.onError(`signalling failed (${row.type})`, err)) }, options.now)
  }

  /** fresh TURN credentials for the connections that come next */
  setIceServers(servers: IceServer[]): void {
    this.options = { ...this.options, iceServers: servers }
  }

  listen(): void {
    this.mailbox.start()
  }

  /** stop answering; open channels are left alone (the room decides what happens to them) */
  stopListening(): void {
    this.mailbox.stop()
  }

  /** a new room code: its mailbox starts empty */
  newRoom(): void {
    this.mailbox.reset()
  }

  private config(): PeerConfig {
    const c: PeerConfig = {
      iceServers: this.options.iceServers as RTCIceServer[],
      iceTransportPolicy: this.options.relayOnly ? 'relay' : 'all',
    }
    if (this.options.portRange) {
      c.portRangeBegin = this.options.portRange[0]
      c.portRangeEnd = this.options.portRange[1]
    }
    return c
  }

  private async onSignal(row: HostSignal): Promise<void> {
    if (row.type === 'offer') {
      // only offers the site vouched for: the mailbox records who posted each one
      if (row.from_user_id === null) return
      const player: Player = { userId: row.from_user_id, name: row.from_name ?? 'Survivor', deviceId: row.from_device_id }
      await this.answer(row.from, player, row.data as unknown as RTCSessionDescriptionInit)
    } else if (row.type === 'candidate') {
      const peer = this.peers.get(row.from)
      if (!peer) return
      const c = row.data as RTCIceCandidateInit
      if (!peer.remoteSet) peer.pending.push(c)
      else await peer.pc.addIceCandidate(c).catch(() => {})
    }
  }

  private async answer(remoteId: string, player: Player, offer: RTCSessionDescriptionInit): Promise<void> {
    this.drop(remoteId)
    const pc = this.makePeer(this.config())
    const entry: PeerEntry = {
      pc, player, pending: [], remoteSet: false, opened: false,
      timer: setTimeout(() => {
        if (entry.opened) return
        this.stats.failed++
        this.onError('a player could not connect in time', { userId: player.userId })
        this.drop(remoteId)
      }, CONNECT_TIMEOUT_MS),
    }
    this.peers.set(remoteId, entry)
    pc.onicecandidate = e => {
      if (e.candidate) this.site.signal(remoteId, 'candidate', e.candidate.toJSON() as Record<string, unknown>).catch(() => {})
    }
    pc.ondatachannel = ev => this.wire(remoteId, entry, ev.channel)
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && !entry.opened) {
        this.stats.failed++
        this.onError('ICE failed for a player', { userId: player.userId })
      }
    }
    await pc.setRemoteDescription(offer)
    entry.remoteSet = true
    for (const c of entry.pending) await pc.addIceCandidate(c).catch(() => {})
    entry.pending = []
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await this.site.signal(remoteId, 'answer', { type: answer.type, sdp: answer.sdp })
  }

  private wire(remoteId: string, entry: PeerEntry, dc: RTCDataChannel): void {
    dc.binaryType = 'arraybuffer'
    let closed = false
    const link: Link = {
      id: remoteId,
      send: bytes => { if (dc.readyState === 'open') dc.send(bytes as Uint8Array<ArrayBuffer>) },
      close: () => { dc.close(); entry.pc.close() },
    }
    const close = () => {
      if (closed) return
      closed = true
      if (this.links.get(remoteId) === link) this.links.delete(remoteId)
      if (this.peers.get(remoteId) === entry) this.peers.delete(remoteId)
      clearTimeout(entry.timer)
      this.events.onClose(link)
    }
    dc.onmessage = ev => {
      const data: unknown = ev.data
      if (data instanceof ArrayBuffer) this.events.onData(link, new Uint8Array(data))
      else if (ArrayBuffer.isView(data)) this.events.onData(link, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    }
    dc.onopen = () => {
      entry.opened = true
      clearTimeout(entry.timer)
      this.stats.opened++
      void this.recordType(entry.pc)
      this.links.set(remoteId, link)
      this.events.onOpen(link, entry.player)
    }
    dc.onclose = close
    entry.pc.addEventListener('connectionstatechange', () => {
      const s = entry.pc.connectionState
      if (entry.opened && (s === 'failed' || s === 'closed' || s === 'disconnected')) close()
    })
  }

  /** host (direct on the LAN / a forwarded port), srflx (hole-punched) or relay (TURN) */
  private async recordType(pc: RTCPeerConnection): Promise<void> {
    let type = 'unknown'
    try {
      const report = await pc.getStats()
      report.forEach((s: { type?: string; state?: string; selected?: boolean; nominated?: boolean; localCandidateId?: string }) => {
        if (s.type !== 'candidate-pair' || !(s.selected || s.nominated || s.state === 'succeeded') || !s.localCandidateId) return
        const local = report.get(s.localCandidateId) as { candidateType?: string } | undefined
        if (local?.candidateType) type = local.candidateType
      })
    } catch {
      // stats are diagnostics only
    }
    this.stats.types[type] = (this.stats.types[type] ?? 0) + 1
  }

  private drop(remoteId: string): void {
    const old = this.peers.get(remoteId)
    if (!old) return
    clearTimeout(old.timer)
    this.peers.delete(remoteId)
    old.pc.close()
  }

  dispose(): void {
    this.mailbox.stop()
    for (const l of [...this.links.values()]) l.close()
    this.links.clear()
    for (const id of [...this.peers.keys()]) this.drop(id)
  }
}
