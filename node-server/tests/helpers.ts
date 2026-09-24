import { DateTime } from 'luxon'
import type { Group } from '@japa/runner/core'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import adminConfig from '#config/admin'
import Device from '#models/device'
import Setting from '#models/setting'
import User from '#models/user'
import rooms from '#game-server/registry'

/** every test starts from empty tables, no rate-limit counters, no running rooms */
export function freshState(group: Group): void {
  group.each.setup(async () => {
    // truncates when the test ends, not now
    const truncate = await testUtils.db().truncate()
    Setting.forget()
    await limiter.clear(['memory'])
    adminConfig.guestLogin = false
    return async () => {
      // closing a room saves its world, so the rooms go first
      await rooms.shutdown()
      await truncate()
    }
  })
}

let seq = 0

export async function makeUser(attrs: Partial<{ name: string; email: string; password: string; isAdmin: boolean; isDisabled: boolean }> = {}): Promise<User> {
  seq++
  return User.create({
    name: attrs.name ?? `Player ${seq}`,
    email: attrs.email ?? `player${seq}@example.test`,
    password: attrs.password ?? 'secret',
    isAdmin: attrs.isAdmin ?? false,
    isDisabled: attrs.isDisabled ?? false,
  })
}

/** an approved browser for this user: send its token as the encrypted `bs_device` cookie */
export async function approvedDevice(user: User, approved = true): Promise<Device> {
  return Device.create({
    token: Device.newToken(),
    userId: user.id,
    approvedAt: approved ? DateTime.now() : null,
  })
}

/** a signed-in player whose browser is approved; `cookie` goes on every request */
export async function player(attrs: Parameters<typeof makeUser>[0] = {}): Promise<{ user: User; device: Device }> {
  const user = await makeUser(attrs)
  return { user, device: await approvedDevice(user) }
}
