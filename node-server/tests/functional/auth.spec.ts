import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import env from '#start/env'
import adminConfig from '#config/admin'
import Device from '#models/device'
import Setting from '#models/setting'
import User from '#models/user'
import { approvedDevice, freshState, makeUser, player } from '#tests/helpers'

const CREDENTIALS = { email: 'sam@example.test', password: 'secret' }

test.group('Sign-in', (group) => {
  freshState(group)

  test('the login page is the only page a guest sees', async ({ client }) => {
    const res = await client.get('/').redirects(0)
    res.assertStatus(302)
    res.assertHeader('location', '/login')
    const login = await client.get('/login').withInertia()
    login.assertStatus(200)
    login.assertInertiaComponent('Login')
  })

  test('wrong credentials are refused on the email field', async ({ client }) => {
    await makeUser(CREDENTIALS)
    const res = await client.post('/login').form({ ...CREDENTIALS, password: 'nope' }).withCsrfToken().redirects(0)
    res.assertStatus(302)
    res.assertFlashMessage('inputErrorsBag', { email: ['Wrong email or password.'] })
  })

  test('a new browser is parked until an admin approves it, then the same browser signs in', async ({ client, assert }) => {
    const user = await makeUser(CREDENTIALS)
    const first = await client.post('/login').form(CREDENTIALS).withCsrfToken().redirects(0)
    first.assertHeader('location', '/pending-approval')
    const device = await Device.findByOrFail('user_id', user.id)
    assert.isNull(device.approvedAt)

    const pending = await client.get('/pending-approval/status').withEncryptedCookie('bs_device', device.token)
    pending.assertBodyContains({ known: true, approved: false })

    device.approvedAt = DateTime.now()
    await device.save()
    const second = await client.post('/login').form(CREDENTIALS).withEncryptedCookie('bs_device', device.token).withCsrfToken().redirects(0)
    second.assertHeader('location', '/')
    assert.equal((await Device.all()).length, 1)
    await user.refresh()
    assert.isNotNull(user.lastLoginAt)
  })

  test('the pending page needs a device cookie', async ({ client }) => {
    const res = await client.get('/pending-approval').redirects(0)
    res.assertHeader('location', '/login')
    const status = await client.get('/pending-approval/status')
    status.assertBodyContains({ known: false, approved: false })
  })

  test('admins bypass device approval', async ({ client }) => {
    await makeUser({ ...CREDENTIALS, isAdmin: true })
    const res = await client.post('/login').form(CREDENTIALS).withCsrfToken().redirects(0)
    res.assertHeader('location', '/')
  })

  test('a disabled account is refused', async ({ client }) => {
    await makeUser({ ...CREDENTIALS, isDisabled: true })
    const res = await client.post('/login').form(CREDENTIALS).withCsrfToken().redirects(0)
    res.assertFlashMessage('inputErrorsBag', { email: ['This account has been disabled.'] })
  })

  test('a closed login window refuses players but not admins', async ({ client }) => {
    // a window that opens on no day at all is always closed
    await Setting.setMany({ login_window_enabled: '1', login_window_days: '', login_window_timezone: 'UTC' })
    const user = await makeUser(CREDENTIALS)
    const device = await approvedDevice(user)
    const res = await client.post('/login').form(CREDENTIALS).withEncryptedCookie('bs_device', device.token).withCsrfToken().redirects(0)
    res.assertFlashMessage('inputErrorsBag', { email: ['The server is closed right now.'] })

    user.isAdmin = true
    await user.save()
    const admin = await client.post('/login').form(CREDENTIALS).withCsrfToken().redirects(0)
    admin.assertHeader('location', '/')
  })

  test('revoking a browser ends its running session', async ({ client }) => {
    const { user, device } = await player()
    const ok = await client.get('/').loginAs(user).withEncryptedCookie('bs_device', device.token).withInertia()
    ok.assertInertiaComponent('Play')

    await device.delete()
    const page = await client.get('/').loginAs(user).withEncryptedCookie('bs_device', device.token).redirects(0)
    page.assertHeader('location', '/pending-approval')
    const api = await client.get('/api/leaderboard').loginAs(user).withEncryptedCookie('bs_device', device.token)
    api.assertStatus(403)
  })

  test('the play page carries the menu props', async ({ client, assert }) => {
    const { user, device } = await player({ name: 'Sam' })
    const res = await client.get('/').loginAs(user).withEncryptedCookie('bs_device', device.token).withInertia()
    res.assertInertiaPropsContains({ auth: { user: { id: user.id, name: 'Sam', is_admin: false } } })
    const props = res.inertiaProps as Record<string, unknown>
    assert.properties(props, ['leaderboard', 'worlds', 'presence', 'rules'])
    assert.deepEqual(props.presence, { online: 0, host_name: null })
  })

  test('signing out ends the session', async ({ client }) => {
    const { user, device } = await player()
    const res = await client.post('/logout').loginAs(user).withEncryptedCookie('bs_device', device.token).withCsrfToken().redirects(0)
    res.assertHeader('location', '/login')
  })
})

test.group('Dev guest sign-in', (group) => {
  freshState(group)

  test('is a 404 unless enabled', async ({ client }) => {
    const res = await client.post('/login/guest').withCsrfToken()
    res.assertStatus(404)
  })

  test('creates the guest once and approves this browser on the spot', async ({ client, assert }) => {
    adminConfig.guestLogin = true
    const res = await client.post('/login/guest').withCsrfToken().redirects(0)
    res.assertHeader('location', '/')
    const guest = await User.findByOrFail('email', 'guest@localhost')
    const device = await Device.findByOrFail('user_id', guest.id)
    assert.isTrue(device.isApproved())
    await client.post('/login/guest').withCsrfToken().redirects(0)
    assert.lengthOf(await User.all(), 1)
  })
})

test.group('Maintenance', (group) => {
  freshState(group)
  group.each.teardown(() => env.set('APP_MAINTENANCE_MODE', false))

  test('takes every page down except the health probe', async ({ client }) => {
    env.set('APP_MAINTENANCE_MODE', true)
    ;(await client.get('/login')).assertStatus(503)
    ;(await client.get('/up')).assertStatus(200)
  })
})
