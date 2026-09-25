import { afterEach, describe, expect, test } from 'vitest'
import { RTCPeerConnection } from 'node-datachannel/polyfill'
import { FREEZE_AFTER_MS, PcHost } from '../src/PcHost'
import { SiteError } from '../src/site'
import { decode, encode, PROTOCOL_VERSION, type HostMessage } from '@game/net/protocol'
import type { Player } from '../src/room/GameRoom'
import type { SaveData } from '@game/net/api'
import { FakeSite } from './fakeSite'
import { connectClient, type TestClient } from './webrtcClient'

const ana: Player = { userId: 1, name: 'Ana', deviceId: 10 }
const quiet = { info: () => {}, error: () => {} }
const until = async (cond: () => boolean, ms = 8000) => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 20))
  }
}
const messages = (c: TestClient) => c.received.map(b => decode<HostMessage>(b))

/** real time, plus however far a test has jumped ahead */
function makeHost(site: FakeSite, clock = { skip: 0 }) {
  const awake: boolean[] = []
  let revoked = false
  const host = new PcHost({
    site,
    version: 'test',
    makePeer: c => new RTCPeerConnection(c) as unknown as globalThis.RTCPeerConnection,
    transport: {},
    log: quiet,
    keepAwake: on => awake.push(on),
    onRevoked: () => { revoked = true },
    now: () => Date.now() + clock.skip,
    peerId: 'pcPEERpcPEER0001',
  })
  return { host, awake, clock, revoked: () => revoked }
}

async function joinWithHello(site: FakeSite, host: PcHost): Promise<TestClient> {
  const client = await connectClient(site, 'anaAAAAAAAAA', ana)
  // today's web client sends a v1 hello with its own idea of who it is
  client.channel.send(encode({ t: 'hello', v: PROTOCOL_VERSION, name: 'Ana', userId: 1 }) as Uint8Array<ArrayBuffer>)
  await until(() => host.room!.playerCount === 1 && messages(client).some(m => m.t === 'welcome'))
  return client
}

describe('PcHost', () => {
  const cleanup: (() => unknown)[] = []
  afterEach(async () => {
    for (const f of cleanup.splice(0)) await f()
  })

  test('registers, loads the global save and hosts it for a v1 client', async () => {
    const site = new FakeSite()
    const { host, awake } = makeHost(site)
    cleanup.push(() => host.stop('restart'))
    await host.start()
    expect(host.phase).toBe('online')
    expect(site.beats[0]).toMatchObject({ version: 'test', peer_id: 'pcPEERpcPEER0001', room: { players: 0, user_ids: [] } })

    const client = await joinWithHello(site, host)
    cleanup.push(() => client.close())
    const welcome = messages(client).find(m => m.t === 'welcome')
    expect(welcome).toMatchObject({ t: 'welcome', v: 1, you: 'anaAAAAAAAAA' })
    await until(() => messages(client).some(m => m.t === 'snap'))

    // the heartbeat vouches for who is playing, and Windows is kept awake meanwhile
    await host.beat()
    expect(site.beats.at(-1)?.room).toMatchObject({ players: 1, user_ids: [1] })
    expect(awake.at(-1)).toBe(true)
  }, 30_000)

  test('a PC cut off from the site freezes the world, and resumes once the heartbeat gets through', async () => {
    const site = new FakeSite()
    const { host, clock } = makeHost(site)
    cleanup.push(() => host.stop('restart'))
    await host.start()
    const client = await joinWithHello(site, host)
    cleanup.push(() => client.close())

    site.replies = [new SiteError(0, 'Could not reach the site')]
    clock.skip += FREEZE_AFTER_MS / 2
    await host.beat()
    expect(host.room!.isFrozen).toBe(false)
    clock.skip += FREEZE_AFTER_MS
    await host.beat()
    expect(host.room!.isFrozen).toBe(true)
    // frozen: the client hears nothing and pauses by itself (once what was in flight has landed)
    await new Promise(r => setTimeout(r, 150))
    const before = messages(client).filter(m => m.t === 'snap').length
    await new Promise(r => setTimeout(r, 300))
    expect(messages(client).filter(m => m.t === 'snap').length).toBe(before)

    site.replies = []
    await host.beat()
    expect(host.room!.isFrozen).toBe(false)
    await until(() => messages(client).filter(m => m.t === 'snap').length > before)
  }, 30_000)

  test('standby sends everyone off after a save, and the PC takes the world back with the browsers\' save', async () => {
    const site = new FakeSite()
    const { host } = makeHost(site)
    cleanup.push(() => host.stop('restart'))
    await host.start()
    const client = await joinWithHello(site, host)
    cleanup.push(() => client.close())

    site.replies = [{ state: 'standby' }]
    await host.beat()
    expect(host.phase).toBe('standby')
    expect(host.room).toBeNull()
    await until(() => messages(client).some(m => m.t === 'bye'))
    expect(site.saves).toBeGreaterThanOrEqual(1)

    // the browsers played on and saved a later clock
    site.save = { ...site.save!, time: 5000 }
    site.replies = []
    await host.beat()
    expect(host.phase).toBe('online')
    expect(host.room!.sim.dayNight.time).toBe(5000)
  }, 30_000)

  test('the admin\'s reset starts a fresh world and saves it', async () => {
    const site = new FakeSite()
    site.save = null
    const { host } = makeHost(site)
    cleanup.push(() => host.stop('restart'))
    await host.start()
    host.room!.sim.dayNight.time = 4000
    site.commands = ['reset']
    await host.beat()
    expect(host.room!.sim.dayNight.time).toBe(0)
    expect((site.save as SaveData | null)?.time).toBe(0)
  }, 30_000)

  test('stopping saves the world and tells the site whether it is a restart or going offline', async () => {
    const site = new FakeSite()
    const { host } = makeHost(site)
    await host.start()
    const saves = site.saves
    await host.stop('offline')
    expect(site.saves).toBe(saves + 1)
    expect(site.beats.at(-1)).toEqual({ version: 'test', peer_id: 'pcPEERpcPEER0001', going: 'offline' })
    expect(host.phase).toBe('stopped')
  }, 30_000)

  test('a revoked token stops the host; a taken room code draws another', async () => {
    const site = new FakeSite()
    const { host, revoked } = makeHost(site)
    cleanup.push(() => host.stop('restart'))
    await host.start()
    const code = site.beats[0].room!.code
    site.replies = [new SiteError(409, 'That room code is in use — pick another.'), { state: 'offline' }]
    await host.beat()
    await host.beat()
    expect(site.beats.at(-1)!.room!.code).not.toBe(code)

    site.replies = [new SiteError(401, 'Unknown or revoked host token.')]
    await host.beat()
    expect(revoked()).toBe(true)
  }, 30_000)
})
