import { test } from '@japa/runner'
import WebSocket from 'ws'
import type { ApiClient } from '@japa/api-client'
import env from '#start/env'
import World from '#models/world'
import rooms from '#game-server/registry'
import { decode, encode, PROTOCOL_VERSION, type ClientMessage, type HostMessage } from '#game/net/protocol'
import { BLOCK, AIR } from '#game/world/palette'
import { freshState, player } from '#tests/helpers'

type Player = Awaited<ReturnType<typeof player>>

/** one player's socket, collecting everything the server sends */
class Link {
  readonly inbox: HostMessage[] = []
  private readonly ws: WebSocket
  readonly closed: Promise<void>

  constructor(ticket: string) {
    this.ws = new WebSocket(`ws://${env.get('HOST')}:${env.get('PORT')}/ws?ticket=${encodeURIComponent(ticket)}`)
    this.ws.on('message', (data) => this.inbox.push(decode<HostMessage>(data as Buffer)))
    this.closed = new Promise((resolve) => this.ws.on('close', () => resolve()))
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve())
      this.ws.once('error', reject)
    })
  }

  send(msg: ClientMessage | Record<string, unknown>): void {
    this.ws.send(encode(msg as ClientMessage))
  }

  close(): void {
    this.ws.close()
  }

  /** the first message (from now on, or already in) that matches */
  async waitFor<T extends HostMessage = HostMessage>(match: (m: HostMessage) => boolean, ms = 5000): Promise<T> {
    const deadline = Date.now() + ms
    for (;;) {
      const hit = this.inbox.find(match)
      if (hit) return hit as T
      if (Date.now() > deadline) throw new Error(`timed out; got ${this.inbox.map((m) => m.t).join(', ')}`)
      await new Promise((r) => setTimeout(r, 20))
    }
  }
}

function as(client: ApiClient, p: Player) {
  return (url: string) => client.post(url).loginAs(p.user).withEncryptedCookie('bs_device', p.device.token).withCsrfToken()
}

/** into a room: a ticket from the API, the socket, the hello, the welcome */
async function enter(ticket: string, name = 'Player'): Promise<Link> {
  const link = new Link(ticket)
  await link.opened()
  link.send({ t: 'hello', v: PROTOCOL_VERSION, name })
  await link.waitFor((m) => m.t === 'welcome')
  return link
}

const isWelcome = (m: HostMessage): m is Extract<HostMessage, { t: 'welcome' }> => m.t === 'welcome'
const isSnap = (m: HostMessage): m is Extract<HostMessage, { t: 'snap' }> => m.t === 'snap'

test.group('Playing on the server', (group) => {
  freshState(group)

  test('two players in one world see each other and the same block edits, and the world is saved', async ({ client, assert }) => {
    const host = await player({ name: 'Host' })
    const friend = await player({ name: 'Friend' })
    const { room, ticket } = (await as(client, host)('/api/play').json({ world: 'own' })).body()
    const a = await enter(ticket)
    const welcome = await a.waitFor<Extract<HostMessage, { t: 'welcome' }>>(isWelcome)
    assert.equal(welcome.v, PROTOCOL_VERSION)

    await as(client, host)(`/api/rooms/${room.code}/invites`).json({ user_id: friend.user.id })
    const [invite] = (await client.get('/api/invites').loginAs(friend.user).withEncryptedCookie('bs_device', friend.device.token)).body().invites
    await as(client, friend)(`/api/invites/${invite.id}/accept`)
    const join = (await as(client, friend)(`/api/rooms/${room.code}/join`)).body()
    const b = await enter(join.ticket)

    // the server knows who they are from the ticket, whatever name the client sends
    const snap = await b.waitFor<Extract<HostMessage, { t: 'snap' }>>((m) => isSnap(m) && m.players.length === 2)
    assert.sameMembers(snap.players.map((p) => p.name), ['Host', 'Friend'])

    // a block beside the spawn, broken by one player, reaches both
    const sim = rooms.running(room.code)!.sim
    const sp = sim.terrain.spawn()
    const cell = { x: Math.floor(sp.x) + 2, y: Math.floor(sp.y), z: Math.floor(sp.z) }
    sim.world.setBlock(cell.x, cell.y, cell.z, BLOCK.dirt)
    a.send({ t: 'break', ...cell })
    const edit = (m: HostMessage) => m.t === 'blocks' && m.edits.some((e) => e.x === cell.x && e.y === cell.y && e.z === cell.z && e.id === AIR)
    await a.waitFor(edit)
    await b.waitFor(edit)

    // leaving saves what the world holds, both players included
    a.close()
    b.close()
    await Promise.all([a.closed, b.closed])
    const deadline = Date.now() + 5000
    let saved: World | null = null
    while (!saved && Date.now() < deadline) {
      saved = await World.ownOf(host.user.id)
      if (!saved) await new Promise((r) => setTimeout(r, 50))
    }
    assert.isNotNull(saved)
    assert.equal(saved!.players, 2)
  })

  test('a ticket works once, and a made-up one is turned away with a reason', async ({ client, assert }) => {
    const p = await player()
    const { ticket } = (await as(client, p)('/api/play').json({ world: 'global' })).body()
    const first = await enter(ticket)
    first.close()

    const again = new Link(ticket)
    await again.closed
    const reason = again.inbox.find((m) => m.t === 'state')
    assert.equal(reason && reason.t === 'state' ? reason.message : '', 'That link has expired — join again from the lobby.')

    const fake = new Link('not-a-ticket')
    await fake.closed
    assert.lengthOf(fake.inbox, 1)
  })

  test('an out-of-date client is told to reload', async ({ client, assert }) => {
    const p = await player()
    const { ticket } = (await as(client, p)('/api/play').json({ world: 'own' })).body()
    const link = new Link(ticket)
    await link.opened()
    link.send({ t: 'hello', v: 1, name: 'Old' })
    await link.closed
    assert.isTrue(link.inbox.some((m) => m.t === 'state' && m.message === 'This page is out of date — reload it to play.'))
  })

  test('malformed messages are ignored and the game carries on', async ({ client }) => {
    const p = await player()
    const { ticket } = (await as(client, p)('/api/play').json({ world: 'own' })).body()
    const link = await enter(ticket)
    link.send({ t: 'input', x: Number.NaN, y: 'high', z: {} })
    link.send({ t: 'craft', recipe: 'everything' })
    link.send({ t: 'nonsense' })
    await link.waitFor(isSnap)
    link.close()
  })

  test('a second tab of the same account replaces the first', async ({ client, assert }) => {
    const p = await player()
    const one = await enter((await as(client, p)('/api/play').json({ world: 'own' })).body().ticket)
    const two = await enter((await as(client, p)('/api/play').json({ world: 'own' })).body().ticket)
    await one.closed
    assert.isTrue(one.inbox.some((m) => m.t === 'bye'))
    const snap = await two.waitFor<Extract<HostMessage, { t: 'snap' }>>(isSnap)
    assert.lengthOf(snap.players, 1)
    two.close()
  })

  test('the lobby sees who is in the global world', async ({ client }) => {
    const p = await player()
    const link = await enter((await as(client, p)('/api/play').json({ world: 'global' })).body().ticket)
    const presence = await client.get('/api/global/presence').loginAs(p.user).withEncryptedCookie('bs_device', p.device.token)
    presence.assertBody({ online: 1, host_name: 'the server' })
    link.close()
  })

  test('an admin closing the room sends its players back with the reason', async ({ client, assert }) => {
    const p = await player()
    const { room, ticket } = (await as(client, p)('/api/play').json({ world: 'own' })).body()
    const link = await enter(ticket)
    await rooms.close(room.code, 'An admin closed this game.')
    await link.closed
    assert.isTrue(link.inbox.some((m) => m.t === 'state' && m.message === 'An admin closed this game.'))
    assert.isTrue(link.inbox.some((m) => m.t === 'bye'))
  })
})
