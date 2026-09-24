import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import Device from '#models/device'
import Room from '#models/room'
import User from '#models/user'
import World from '#models/world'
import LoginWindow from '#support/login_window'
import rooms from '#game-server/registry'

const count = async (query: { count(col: string): Promise<{ $extras: Record<string, unknown> }[]> }) =>
  Number((await query.count('* as n'))[0].$extras.n)

/** The admin front page: counts, and where to go next. */
export default class DashboardController {
  async handle({ inertia }: HttpContext) {
    // opening the admin section is when stale devices are swept
    await Device.pruneStale()
    const window = await LoginWindow.fromSettings()
    const globalSave = await World.global()

    return inertia.render('Admin/Dashboard', {
      counts: {
        pendingDevices: await Device.pendingCount(),
        approvedDevices: await Device.approvedCount(),
        users: await count(User.query()),
        disabledUsers: await count(User.query().where('is_disabled', true)),
        rooms: await count(Room.query().withScopes((s) => s.live())),
      },
      loginWindow: window.toJSON(),
      windowOpen: window.isOpen(DateTime.now()),
      globalWorld: { save: globalSave?.meta() ?? null, ...rooms.presence() },
    })
  }
}
