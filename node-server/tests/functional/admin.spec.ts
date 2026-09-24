import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import ace from '@adonisjs/core/services/ace'
import type { ApiClient } from '@japa/api-client'
import Device from '#models/device'
import Room from '#models/room'
import RoomSignal from '#models/room_signal'
import Score from '#models/score'
import Setting from '#models/setting'
import User from '#models/user'
import World from '#models/world'
import rooms from '#game-server/registry'
import AdminSync from '#commands/admin_sync'
import MakeAdmin from '#commands/make_admin'
import { sqlTime } from '#support/time'
import { freshState, makeUser, player } from '#tests/helpers'

type Player = Awaited<ReturnType<typeof player>>

function as(client: ApiClient, p: Player) {
  const on = <T extends { loginAs(u: User): T; withEncryptedCookie(k: string, v: string): T }>(r: T) =>
    r.loginAs(p.user).withEncryptedCookie('bs_device', p.device.token)
  return {
    get: (url: string) => on(client.get(url)).withInertia(),
    post: (url: string) => on(client.post(url)).withCsrfToken().redirects(0),
    put: (url: string) => on(client.put(url)).withCsrfToken().redirects(0),
    patch: (url: string) => on(client.patch(url)).withCsrfToken().redirects(0),
    delete: (url: string) => on(client.delete(url)).withCsrfToken().redirects(0),
  }
}

test.group('Admin section', (group) => {
  freshState(group)

  test('is for admins only', async ({ client }) => {
    const p = await player()
    ;(await as(client, p).get('/admin')).assertStatus(403)
    ;(await client.get('/admin').redirects(0)).assertHeader('location', '/login')
    const admin = await player({ isAdmin: true })
    const res = await as(client, admin).get('/admin')
    res.assertInertiaComponent('Admin/Dashboard')
    res.assertInertiaPropsContains({ counts: { users: 2 }, globalWorld: { online: 0, save: null } })
  })

  test('the ADMIN_EMAIL account is an admin without the flag', async ({ client }) => {
    const env = await player({ email: 'admin@example.test' })
    ;(await as(client, env).get('/admin')).assertStatus(200)
  })

  test('operating hours are shown, saved and validated', async ({ client, assert }) => {
    const admin = await player({ isAdmin: true })
    ;(await as(client, admin).get('/admin/hours')).assertInertiaPropsContains({ loginWindow: { enabled: false } })
    const saved = await as(client, admin).put('/admin/hours').form({ enabled: true, start: '18:00', end: '22:00', days: [1, 3], timezone: 'Africa/Johannesburg' })
    saved.assertStatus(302)
    Setting.forget()
    assert.equal(await Setting.get('login_window_days'), '1,3')
    const bad = await as(client, admin).put('/admin/hours').form({ enabled: true, start: '25:00', end: '22:00', days: [9], timezone: 'Mars/Base' })
    bad.assertStatus(302)
    assert.includeMembers(Object.keys(bad.flashMessages().inputErrorsBag), ['start', 'timezone'])
    Setting.forget()
    assert.equal(await Setting.get('login_window_start'), '18:00')
  })

  test('devices are approved, labelled and removed', async ({ client, assert }) => {
    const admin = await player({ isAdmin: true })
    const sam = await makeUser()
    const pending = await Device.create({ token: Device.newToken(), userId: sam.id })
    const list = await as(client, admin).get('/admin/devices')
    list.assertInertiaComponent('Admin/Devices')
    assert.equal((list.inertiaProps as { devices: { id: number; approved_at: string | null }[] }).devices[0].id, pending.id)

    await as(client, admin).post(`/admin/devices/${pending.id}/approve`)
    await pending.refresh()
    assert.isTrue(pending.isApproved())
    assert.equal(pending.approvedBy, admin.user.id)
    await as(client, admin).patch(`/admin/devices/${pending.id}`).form({ label: 'Front PC' })
    await pending.refresh()
    assert.equal(pending.label, 'Front PC')
    await as(client, admin).delete(`/admin/devices/${pending.id}`)
    assert.isNull(await Device.find(pending.id))
  })

  test('stale pending devices are swept when the devices page opens', async ({ client, assert }) => {
    const admin = await player({ isAdmin: true })
    const old = await Device.create({ token: Device.newToken() })
    await Device.query().where('id', old.id).update({ created_at: sqlTime(DateTime.now().minus({ days: 31 })) })
    await as(client, admin).get('/admin/devices')
    assert.isNull(await Device.find(old.id))
  })

  test('an admin creates and edits accounts; a blank password keeps the old one', async ({ client, assert }) => {
    const admin = await player({ isAdmin: true })
    const created = await as(client, admin).post('/admin/users').form({ name: 'New One', email: 'new@example.test', password: 'x', is_admin: false, is_disabled: false })
    created.assertHeader('location', '/admin/users')
    const user = await User.findByOrFail('email', 'new@example.test')
    const hash = user.password

    const dup = await as(client, admin).post('/admin/users').form({ name: 'New One', email: 'other@example.test', password: 'x', is_admin: false, is_disabled: false })
    assert.property(dup.flashMessages().inputErrorsBag as Record<string, unknown>, 'name')

    await as(client, admin).put(`/admin/users/${user.id}`).form({ name: 'Renamed', email: 'new@example.test', password: '', is_admin: false, is_disabled: true })
    await user.refresh()
    assert.equal(user.name, 'Renamed')
    assert.isTrue(user.isDisabled)
    assert.equal(user.password, hash)
  })

  test('an admin cannot change their own role or delete themselves, nor touch the env admin', async ({ client, assert }) => {
    const admin = await player({ isAdmin: true, name: 'Boss', email: 'boss@example.test' })
    const self = await as(client, admin).put(`/admin/users/${admin.user.id}`).form({ name: 'Boss', email: 'boss@example.test', is_admin: false, is_disabled: false })
    self.assertFlashMessage('inputErrorsBag', { user: ['You cannot change your own admin or disabled status.'] })
    await as(client, admin).delete(`/admin/users/${admin.user.id}`)
    assert.isNotNull(await User.find(admin.user.id))

    const envAdmin = await makeUser({ email: 'admin@example.test' })
    const del = await as(client, admin).delete(`/admin/users/${envAdmin.id}`)
    del.assertFlashMessage('inputErrorsBag', { user: ['That account is the ADMIN_EMAIL admin; remove it from .env first.'] })
  })

  test('deleting a user takes their world, scores and devices along and stops their world', async ({ client, assert }) => {
    const admin = await player({ isAdmin: true })
    const sam = await player()
    const room = await rooms.openOwn(sam.user)
    await Score.create({ userId: sam.user.id, score: 1, nights: 0, kills: 0, deaths: 0, seconds: 0 })
    await World.create({ userId: sam.user.id, kind: 'own', payload: 'x', size: 1 })
    await as(client, admin).delete(`/admin/users/${sam.user.id}`)
    assert.isUndefined(rooms.running(room.code))
    assert.lengthOf(await Score.all(), 0)
    assert.lengthOf(await World.all(), 0)
    assert.isNull(await Device.find(sam.device.id))
  })

  test('the game rules are saved clamped', async ({ client, assert }) => {
    const admin = await player({ isAdmin: true })
    ;(await as(client, admin).get('/admin/rules')).assertInertiaPropsContains({ rules: { day_seconds: 900 }, defaults: { night_seconds: 300 } })
    const rules = { day_seconds: 60, night_seconds: 90, zombies_first_night: 3, zombies_per_night: 2, spawn_delay_seconds: 1, spawn_window_percent: 50 }
    await as(client, admin).put('/admin/rules').form(rules)
    Setting.forget()
    assert.equal(await Setting.get('rules.night_seconds'), '90')
    const bad = await as(client, admin).put('/admin/rules').form({ ...rules, day_seconds: 5 })
    assert.property(bad.flashMessages().inputErrorsBag, 'day_seconds')
    const player1 = await player()
    ;(await as(client, player1).put('/admin/rules').form(rules)).assertStatus(403)
  })

  test('a live room can be force-closed: a server room stops, a peer-to-peer one goes with its mail', async ({ client, assert }) => {
    const admin = await player({ isAdmin: true })
    const sam = await player()
    const serverRoom = await rooms.openOwn(sam.user)
    await as(client, admin).delete(`/admin/rooms/${serverRoom.code}`)
    assert.isUndefined(rooms.running(serverRoom.code))
    assert.isNull(await Room.findBy('code', serverRoom.code))

    await Room.create({ code: 'PEERAA', hostPeerId: 'peer-1', hostName: 'X', worldKind: 'own', players: 1, expiresAt: Room.freshExpiry() })
    await RoomSignal.create({ roomCode: 'PEERAA', fromPeer: 'a', toPeer: 'b', type: 'offer', data: '{}' })
    const res = await as(client, admin).get('/admin/rooms')
    res.assertInertiaPropsContains({ rooms: [{ code: 'PEERAA' }] })
    await as(client, admin).delete('/admin/rooms/PEERAA')
    assert.lengthOf(await Room.all(), 0)
    assert.lengthOf(await RoomSignal.all(), 0)
  })

  test('the global world resets only when empty', async ({ client, assert }) => {
    const admin = await player({ isAdmin: true })
    await World.create({ userId: null, kind: 'global', payload: 'x', size: 1 })
    await as(client, admin).delete('/admin/global-world')
    assert.isNull(await World.global())
  })
})

test.group('Admin commands', (group) => {
  freshState(group)

  test('admin:sync creates the env admin', async ({ assert }) => {
    const { default: adminConfig } = await import('#config/admin')
    adminConfig.password = 'from-env'
    try {
      const command = await ace.create(AdminSync, [])
      await command.exec()
      command.assertSucceeded()
      const admin = await User.findByOrFail('email', 'admin@example.test')
      assert.isTrue(admin.isAdmin)
      assert.equal(admin.name, 'Admin')
    } finally {
      adminConfig.password = ''
    }
  })

  test('user:make-admin promotes an existing player and approves their devices', async ({ assert }) => {
    const sam = await makeUser({ email: 'sam@example.test' })
    const device = await Device.create({ token: Device.newToken(), userId: sam.id })
    const command = await ace.create(MakeAdmin, ['sam@example.test'])
    await command.exec()
    command.assertSucceeded()
    await sam.refresh()
    await device.refresh()
    assert.isTrue(sam.isAdmin)
    assert.isTrue(device.isApproved())
  })
})
