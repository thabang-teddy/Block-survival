import { afterEach, describe, expect, test } from 'vitest'
import { RTCPeerConnection } from 'node-datachannel/polyfill'
import { HostTransport, type Link } from '../src/net/HostTransport'
import type { Player } from '../src/room/GameRoom'
import { FakeSite } from './fakeSite'
import { connectClient, type TestClient } from './webrtcClient'

const ana: Player = { userId: 1, name: 'Ana', deviceId: 10 }
const until = async (cond: () => boolean, ms = 5000) => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 20))
  }
}

describe('HostTransport over node-datachannel', () => {
  let transport: HostTransport | null = null
  const clients: TestClient[] = []
  afterEach(() => {
    for (const c of clients.splice(0)) c.close()
    transport?.dispose()
    transport = null
  })

  test('a player the site vouched for gets a DataChannel to the PC, both ways', async () => {
    const site = new FakeSite()
    const opened: { link: Link; player: Player }[] = []
    const data: string[] = []
    transport = new HostTransport(site, {
      onOpen: (link, player) => opened.push({ link, player }),
      onData: (_l, bytes) => data.push(new TextDecoder().decode(bytes)),
      onClose: () => {},
    }, c => new RTCPeerConnection(c) as unknown as globalThis.RTCPeerConnection, { iceServers: [], portRange: [50100, 50199] })
    transport.listen()

    const client = await connectClient(site, 'anaAAAAAAAAA', ana)
    clients.push(client)
    await until(() => opened.length === 1)
    expect(opened[0].player).toEqual(ana)
    expect(opened[0].link.id).toBe('anaAAAAAAAAA')

    client.channel.send(new TextEncoder().encode('hello pc'))
    opened[0].link.send(new TextEncoder().encode('hello player'))
    await until(() => data.length === 1 && client.received.length === 1)
    expect(data).toEqual(['hello pc'])
    expect(new TextDecoder().decode(client.received[0])).toBe('hello player')
    expect(transport.stats.opened).toBe(1)
    await until(() => Object.keys(transport!.stats.types).length === 1)
    // the answer came from the PC's peer id, through the mailbox
    expect(site.rows.some(r => r.type === 'answer' && r.from === site.pcPeer && r.to === 'anaAAAAAAAAA')).toBe(true)
  }, 20_000)

  test('an offer nobody vouched for is never answered', async () => {
    const site = new FakeSite()
    let opened = 0
    transport = new HostTransport(site, { onOpen: () => { opened++ }, onData: () => {}, onClose: () => {} },
      c => new RTCPeerConnection(c) as unknown as globalThis.RTCPeerConnection, { iceServers: [] })
    transport.listen()
    await expect(connectClient(site, 'mallory00000', null, 2500)).rejects.toThrow(/did not answer/)
    expect(opened).toBe(0)
    expect(site.rows.some(r => r.type === 'answer')).toBe(false)
  }, 10_000)

  test('closing a player\'s channel tells the PC', async () => {
    const site = new FakeSite()
    const closed: string[] = []
    let opened = 0
    transport = new HostTransport(site, { onOpen: () => { opened++ }, onData: () => {}, onClose: l => closed.push(l.id) },
      c => new RTCPeerConnection(c) as unknown as globalThis.RTCPeerConnection, { iceServers: [] })
    transport.listen()
    const client = await connectClient(site, 'anaAAAAAAAAA', ana)
    await until(() => opened === 1)
    client.close()
    await until(() => closed.length === 1, 10_000)
    expect(closed).toEqual(['anaAAAAAAAAA'])
    expect(transport.links.size).toBe(0)
  }, 20_000)
})
