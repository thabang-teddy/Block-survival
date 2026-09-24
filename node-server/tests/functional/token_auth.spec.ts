import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Device from '#models/device'
import db from '@adonisjs/lucid/services/db'
import { freshState, makeUser } from '#tests/helpers'

const DEVICE_TOKEN = 'A'.repeat(64)
const SIGN_IN = { email: 'sam@example.test', password: 'secret', device: { token: DEVICE_TOKEN, name: 'Sam laptop' } }

/** approve the native client's device, the way the admin page does */
async function approve(): Promise<void> {
  const device = await Device.findByOrFail('token', DEVICE_TOKEN)
  device.approvedAt = DateTime.now()
  await device.save()
}

test.group('Token sign-in (native client)', (group) => {
  freshState(group)

  test('a new device waits for approval, then gets a token', async ({ client, assert }) => {
    await makeUser({ email: SIGN_IN.email, password: SIGN_IN.password, name: 'Sam' })
    const parked = await client.post('/api/auth/token').json(SIGN_IN)
    parked.assertStatus(403)
    parked.assertBodyContains({ pending: true, device: { approved: false } })
    const device = await Device.findByOrFail('token', DEVICE_TOKEN)
    assert.equal(device.label, 'Sam laptop')

    ;(await client.post('/api/auth/status').json({ device: DEVICE_TOKEN })).assertBodyContains({ known: true, approved: false })
    await approve()
    const ok = await client.post('/api/auth/token').json(SIGN_IN)
    ok.assertStatus(201)
    ok.assertBodyContains({ user: { name: 'Sam', is_admin: false } })
    assert.isString(ok.body().token)
    const row = await db.from('auth_access_tokens').first()
    assert.equal(row.device_id, device.id)
  })

  test('wrong credentials and malformed devices are 422s in the Laravel shape', async ({ client }) => {
    await makeUser({ email: SIGN_IN.email, password: SIGN_IN.password })
    const wrong = await client.post('/api/auth/token').json({ ...SIGN_IN, password: 'nope' })
    wrong.assertStatus(422)
    wrong.assertBodyContains({ message: 'Wrong email or password.', errors: { email: ['Wrong email or password.'] } })
    const bad = await client.post('/api/auth/token').json({ ...SIGN_IN, device: { token: 'short', name: 'x' } })
    bad.assertStatus(422)
  })

  test('a bearer token reaches the API without a CSRF token, and logout revokes it', async ({ client, assert }) => {
    await makeUser({ email: SIGN_IN.email, password: SIGN_IN.password, name: 'Sam' })
    await client.post('/api/auth/token').json(SIGN_IN)
    await approve()
    const { token } = (await client.post('/api/auth/token').json(SIGN_IN)).body()

    const me = await client.get('/api/auth/me').header('Authorization', `Bearer ${token}`)
    me.assertStatus(200)
    me.assertBodyContains({ user: { name: 'Sam' }, worlds: { own: null, global: null } })
    // a state-changing call with no session and no CSRF token
    const score = await client.post('/api/scores').header('Authorization', `Bearer ${token}`).json({ nights: 2, kills: 4, deaths: 1, seconds: 100 })
    score.assertStatus(201)
    score.assertBodyContains({ score: 220, best: 220 })

    ;(await client.post('/api/auth/logout').header('Authorization', `Bearer ${token}`)).assertStatus(204)
    ;(await client.get('/api/auth/me').header('Authorization', `Bearer ${token}`)).assertStatus(401)
    assert.lengthOf(await db.from('auth_access_tokens'), 0)
  })

  test('revoking the device kills its token', async ({ client, assert }) => {
    await makeUser({ email: SIGN_IN.email, password: SIGN_IN.password })
    await client.post('/api/auth/token').json(SIGN_IN)
    await approve()
    const { token } = (await client.post('/api/auth/token').json(SIGN_IN)).body()
    const device = await Device.findByOrFail('token', DEVICE_TOKEN)
    device.approvedAt = null
    await device.save()

    const res = await client.get('/api/auth/me').header('Authorization', `Bearer ${token}`)
    res.assertStatus(403)
    res.assertBodyContains({ message: 'This PC is waiting for admin approval.' })
    assert.lengthOf(await db.from('auth_access_tokens'), 0)
  })

  test('an unauthenticated API call is a 401, never a redirect', async ({ client }) => {
    const res = await client.get('/api/leaderboard').redirects(0)
    res.assertStatus(401)
    res.assertBody({ message: 'Unauthenticated.' })
  })
})
