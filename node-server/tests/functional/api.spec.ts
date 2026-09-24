import { test } from '@japa/runner'
import { gzipSync } from 'node:zlib'
import type { ApiClient } from '@japa/api-client'
import Room from '#models/room'
import RoomInvite from '#models/room_invite'
import RoomSignal from '#models/room_signal'
import User from '#models/user'
import World from '#models/world'
import Setting from '#models/setting'
import rooms from '#game-server/registry'
import { MAX_INFLATED_BYTES } from '#services/world_store'
import { freshState, player } from '#tests/helpers'

type Player = Awaited<ReturnType<typeof player>>

/** a request as this signed-in player, from their approved browser */
function as(client: ApiClient, p: Player) {
  return {
    get: (url: string) => client.get(url).loginAs(p.user).withEncryptedCookie('bs_device', p.device.token),
    post: (url: string) => client.post(url).loginAs(p.user).withEncryptedCookie('bs_device', p.device.token).withCsrfToken(),
    put: (url: string) => client.put(url).loginAs(p.user).withEncryptedCookie('bs_device', p.device.token).withCsrfToken(),
    patch: (url: string) => client.patch(url).loginAs(p.user).withEncryptedCookie('bs_device', p.device.token).withCsrfToken(),
    delete: (url: string) => client.delete(url).loginAs(p.user).withEncryptedCookie('bs_device', p.device.token).withCsrfToken(),
  }
}

/** a raw gzip body, as the native client uploads a world */
function withGzip<T extends { type(v: string): T; request: { send(b: Buffer): unknown } }>(req: T, bytes: Buffer): T {
  req.type('application/gzip')
  req.request.send(bytes)
  return req
}

const save = (players: Record<string, unknown> = { '1': {} }) => gzipSync(JSON.stringify({ version: 3, seed: 5, time: 10, edits: [], players, zombies: [], drops: [], crates: [], savedAt: 0 }))

test.group('Server-hosted play', (group) => {
  freshState(group)

  test('play opens the own world on the server and hands out a ticket; again, the same room', async ({ client, assert }) => {
    const sam = await player({ name: 'Sam' })
    const first = await as(client, sam).post('/api/play').json({ world: 'own' })
    first.assertStatus(200)
    const { room, ticket } = first.body()
    assert.isString(ticket)
    assert.equal(room.host_peer_id, Room.SERVER_HOST)
    assert.equal(room.world_kind, 'own')
    assert.isDefined(rooms.running(room.code))
    const again = await as(client, sam).post('/api/play').json({ world: 'own' })
    assert.equal(again.body().room.code, room.code)
  })

  test('the global world is one room for everyone', async ({ client, assert }) => {
    const a = (await as(client, await player()).post('/api/play').json({ world: 'global' })).body()
    const b = (await as(client, await player()).post('/api/play').json({ world: 'global' })).body()
    assert.equal(a.room.code, b.room.code)
    assert.equal(a.room.world_kind, 'global')
  })

  test('joining someone else\'s room takes an accepted invite', async ({ client }) => {
    const host = await player({ name: 'Host' })
    const friend = await player({ name: 'Friend' })
    const { room } = (await as(client, host).post('/api/play').json({ world: 'own' })).body()

    ;(await as(client, friend).post(`/api/rooms/${room.code}/join`)).assertStatus(403)
    const invited = await as(client, host).post(`/api/rooms/${room.code}/invites`).json({ user_id: friend.user.id })
    invited.assertStatus(201)
    invited.assertBodyContains({ invite: { user_id: friend.user.id, name: 'Friend', status: 'pending' } })

    const mine = await as(client, friend).get('/api/invites')
    mine.assertBodyContains({ invites: [{ code: room.code, host_name: 'Host', status: 'pending', max_players: 4 }] })
    const inviteId = mine.body().invites[0].id
    ;(await as(client, friend).post(`/api/invites/${inviteId}/accept`)).assertBodyContains({ room: { code: room.code } })
    const joined = await as(client, friend).post(`/api/rooms/${room.code}/join`)
    joined.assertStatus(200)
    joined.assertBodyContains({ room: { code: room.code } })

    const list = await as(client, host).get(`/api/rooms/${room.code}/invites`)
    list.assertBodyContains({ invites: [{ name: 'Friend', status: 'accepted' }] })
  })

  test('only the host invites, and not themselves', async ({ client }) => {
    const host = await player()
    const other = await player()
    const { room } = (await as(client, host).post('/api/play').json({ world: 'own' })).body()
    ;(await as(client, other).post(`/api/rooms/${room.code}/invites`).json({ user_id: host.user.id })).assertStatus(403)
    ;(await as(client, host).post(`/api/rooms/${room.code}/invites`).json({ user_id: host.user.id })).assertStatus(422)
  })

  test('the peer-to-peer endpoints cannot touch a room the server runs', async ({ client, assert }) => {
    const host = await player()
    const { room } = (await as(client, host).post('/api/play').json({ world: 'own' })).body()
    const takeover = await as(client, host).post('/api/rooms').json({ code: room.code, host_peer_id: 'peer-aaaaaaaa', host_name: 'X' })
    takeover.assertStatus(409)
    // "server" is not a peer id anyone may claim
    ;(await as(client, host).delete(`/api/rooms/${room.code}`).json({ host_peer_id: 'server' })).assertStatus(422)
    assert.isNotNull(await Room.findBy('code', room.code))
  })
})

test.group('Peer-to-peer rooms (native client)', (group) => {
  freshState(group)

  test('a host registers, refreshes and closes its room; the global world is refused', async ({ client, assert }) => {
    const host = await player()
    const created = await as(client, host).post('/api/rooms').json({ code: 'ABCDEF', host_peer_id: 'peer-12345678', host_name: 'Sam' })
    created.assertStatus(201)
    created.assertBodyContains({ room: { code: 'ABCDEF', host_peer_id: 'peer-12345678', players: 1 } })
    ;(await as(client, host).patch('/api/rooms/ABCDEF').json({ host_peer_id: 'peer-12345678', players: 3 })).assertBodyContains({ room: { players: 3 } })
    ;(await as(client, host).patch('/api/rooms/ABCDEF').json({ host_peer_id: 'someone-else', players: 3 })).assertStatus(404)
    ;(await as(client, host).post('/api/rooms').json({ code: 'GHJKLM', host_peer_id: 'peer-12345678', host_name: 'Sam', world_kind: 'global' })).assertStatus(409)
    await as(client, host).delete('/api/rooms/ABCDEF').json({ host_peer_id: 'peer-12345678' })
    assert.isNull(await Room.findBy('code', 'ABCDEF'))
  })

  test('the signalling mailbox delivers in order to the addressee only', async ({ client }) => {
    const host = await player()
    await as(client, host).post('/api/rooms').json({ code: 'ABCDEF', host_peer_id: 'peer-12345678', host_name: 'Sam' })
    const sdp = { type: 'offer', sdp: 'v=0\r\n' }
    ;(await as(client, host).post('/api/rooms/ABCDEF/signal').json({ from: 'peer-12345678', to: 'peer-87654321', type: 'offer', data: sdp })).assertStatus(201)
    const mail = await as(client, host).get('/api/rooms/ABCDEF/signals?to=peer-87654321&after=0')
    // the SDP keeps its trailing CRLF
    mail.assertBodyContains({ signals: [{ from: 'peer-12345678', type: 'offer', data: sdp }] })
    ;(await as(client, host).get('/api/rooms/ABCDEF/signals?to=peer-12345678')).assertBody({ signals: [] })
  })

  test('the mailbox is closed to players who were not invited', async ({ client, assert }) => {
    const host = await player()
    const stranger = await player()
    await as(client, host).post('/api/rooms').json({ code: 'ABCDEF', host_peer_id: 'peer-12345678', host_name: 'Sam' })
    const post = await as(client, stranger).post('/api/rooms/ABCDEF/signal').json({ from: 'peer-99999999', to: 'peer-12345678', type: 'offer', data: {} })
    post.assertStatus(403)
    ;(await as(client, stranger).get('/api/rooms/ABCDEF/signals?to=peer-12345678')).assertStatus(403)
    ;(await as(client, stranger).get('/api/rooms/NOROOM/signals?to=peer-12345678')).assertStatus(404)
    assert.lengthOf(await RoomSignal.all(), 0)
  })

  test('the global-world queue answers that the server hosts it', async ({ client }) => {
    const p = await player()
    ;(await as(client, p).post('/api/global/join')).assertStatus(409)
    ;(await as(client, p).post('/api/global/claim')).assertStatus(409)
    ;(await as(client, p).post('/api/global/leave')).assertBody({ ok: true })
    ;(await as(client, p).get('/api/global/presence')).assertBody({ online: 0, host_name: null })
  })
})

test.group('Worlds, scores and rules', (group) => {
  freshState(group)

  test('a native host uploads its own world and gets the same bytes back', async ({ client }) => {
    const p = await player()
    const bytes = save({ '1': {}, '2': {} })
    const put = await withGzip(as(client, p).put('/api/world/own?night=3&seconds=77'), bytes)
    put.assertStatus(200)
    put.assertBodyContains({ world: { kind: 'own', night: 3, seconds: 77, players: 2, size: bytes.length } })
    const got = await as(client, p).get('/api/world/own')
    got.assertStatus(200)
    got.assertHeader('x-save-night', '3')
    got.assertHeader('content-length', String(bytes.length))
  })

  test('uploads that are not gzip, or are for the global world, are refused', async ({ client, assert }) => {
    const p = await player()
    ;(await withGzip(as(client, p).put('/api/world/own'), Buffer.from('plain'))).assertStatus(422)
    ;(await withGzip(as(client, p).put('/api/world/global'), save())).assertStatus(409)
    // a small gzip that inflates past the cap (a zip bomb) is refused, not unpacked
    const bomb = gzipSync(Buffer.alloc(MAX_INFLATED_BYTES + 1024, 0x20))
    ;(await withGzip(as(client, p).put('/api/world/own'), bomb)).assertStatus(422)
    // a refused upload stores nothing
    assert.lengthOf(await World.all(), 0)
    ;(await as(client, p).get('/api/world/own')).assertStatus(404)
  })

  test('an own world running on the server is not overwritten from outside, and a reset stops it', async ({ client, assert }) => {
    const p = await player()
    const { room } = (await as(client, p).post('/api/play').json({ world: 'own' })).body()
    ;(await withGzip(as(client, p).put('/api/world/own'), save())).assertStatus(409)
    ;(await as(client, p).delete('/api/world/own')).assertBody({ ok: true })
    assert.isUndefined(rooms.running(room.code))
    assert.isNull(await World.ownOf(p.user.id))
  })

  test('scores are recomputed server-side and the leaderboard keeps each player\'s best', async ({ client }) => {
    const sam = await player({ name: 'Sam' })
    const kim = await player({ name: 'Kim' })
    await as(client, sam).post('/api/scores').json({ nights: 1, kills: 0, deaths: 0, seconds: 10 })
    await as(client, sam).post('/api/scores').json({ nights: 3, kills: 2, deaths: 1, seconds: 10 })
    await as(client, kim).post('/api/scores').json({ nights: 2, kills: 0, deaths: 0, seconds: 10 })
    ;(await as(client, sam).post('/api/scores').json({ nights: -1, kills: 0, deaths: 0, seconds: 0 })).assertStatus(422)
    const board = await as(client, sam).get('/api/leaderboard')
    board.assertBody({ leaderboard: [{ name: 'Sam', score: 310 }, { name: 'Kim', score: 200 }] })
  })

  test('the rules endpoint serves the admin\'s clamped settings', async ({ client }) => {
    await Setting.setMany({ 'rules.day_seconds': '5', 'rules.zombies_per_night': '12' })
    const p = await player()
    const res = await as(client, p).get('/api/rules')
    res.assertBodyContains({ rules: { daySeconds: 30, zombiesPerNight: 12, nightSeconds: 300, spawnWindowPercent: 70 } })
  })

  test('the player list leaves out me and disabled accounts', async ({ client }) => {
    const me = await player({ name: 'Me' })
    await player({ name: 'Other' })
    await player({ name: 'Gone', isDisabled: true })
    ;(await as(client, me).get('/api/players')).assertBody({ players: [{ id: (await User.findByOrFail('name', 'Other')).id, name: 'Other' }] })
  })

  test('an invite into a room that is over cannot be accepted', async ({ client }) => {
    const host = await player()
    const friend = await player()
    const { room } = (await as(client, host).post('/api/play').json({ world: 'own' })).body()
    await as(client, host).post(`/api/rooms/${room.code}/invites`).json({ user_id: friend.user.id })
    const invite = await RoomInvite.firstOrFail()
    await rooms.close(room.code, 'test over', { save: false })
    // the row went with the room, and the invite with it
    ;(await as(client, friend).post(`/api/invites/${invite.id}/accept`)).assertStatus(404)
  })
})
