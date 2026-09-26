/**
 * A player's end of the connection, as the browser's ClientTransport makes it (offer a
 * reliable ordered DataChannel named `game`, trickle candidates through the mailbox) —
 * but on node-datachannel, so tests can join the PC for real.
 */
import { RTCPeerConnection } from 'node-datachannel/polyfill'
import type { FakeSite } from './fakeSite'
import type { Player } from '../src/room/GameRoom'

export interface TestClient {
  channel: RTCDataChannel
  received: Uint8Array[]
  closed: Promise<void>
  close(): void
}

export async function connectClient(site: FakeSite, me: string, player: Player | null, timeoutMs = 10_000): Promise<TestClient> {
  const pc = new RTCPeerConnection({ iceServers: [] }) as unknown as globalThis.RTCPeerConnection
  const dc = pc.createDataChannel('game', { ordered: true })
  dc.binaryType = 'arraybuffer'
  const received: Uint8Array[] = []
  dc.onmessage = ev => { received.push(new Uint8Array(ev.data as ArrayBuffer)) }
  let closedResolve!: () => void
  const closed = new Promise<void>(r => { closedResolve = r })
  dc.onclose = () => closedResolve()
  pc.onicecandidate = e => {
    if (e.candidate) site.post(me, site.pcPeer, 'candidate', e.candidate.toJSON() as Record<string, unknown>, player)
  }
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  site.post(me, site.pcPeer, 'offer', { type: offer.type, sdp: offer.sdp }, player)

  let cursor = 0
  let remoteSet = false
  const pending: RTCIceCandidateInit[] = []
  const poll = setInterval(() => {
    for (const r of site.mailFor(me, cursor)) {
      cursor = r.id
      if (r.type === 'answer') {
        void pc.setRemoteDescription(r.data as unknown as RTCSessionDescriptionInit).then(async () => {
          remoteSet = true
          for (const c of pending) await pc.addIceCandidate(c).catch(() => {})
        })
      } else if (r.type === 'candidate') {
        const c = r.data as RTCIceCandidateInit
        if (remoteSet) void pc.addIceCandidate(c).catch(() => {})
        else pending.push(c)
      }
    }
  }, 50)

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => { clearInterval(poll); pc.close(); reject(new Error('the PC did not answer in time')) }, timeoutMs)
    dc.onopen = () => { clearTimeout(t); resolve() }
  })
  clearInterval(poll)
  return { channel: dc, received, closed, close: () => { dc.close(); pc.close() } }
}
