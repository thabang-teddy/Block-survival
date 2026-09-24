import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import Setting from '#models/setting'
import LoginWindow from '#support/login_window'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** every zone the runtime knows, UTC included */
export function timezones(): string[] {
  const zones = Intl.supportedValuesOf('timeZone')
  return zones.includes('UTC') ? zones : ['UTC', ...zones]
}

const windowValidator = vine.create({
  enabled: vine.boolean(),
  start: vine.string().regex(TIME),
  end: vine.string().regex(TIME),
  days: vine.array(vine.number().withoutDecimals().range([0, 6])).maxLength(7).distinct(),
  timezone: vine.string().in(timezones()),
})

/** Admin page for the operating hours (see app/support/login_window.ts). */
export default class LoginWindowController {
  async show({ inertia }: HttpContext) {
    return inertia.render('Admin/Hours', {
      loginWindow: (await LoginWindow.fromSettings()).toJSON(),
      timezones: timezones(),
    })
  }

  async update({ request, response, session }: HttpContext) {
    const data = await request.validateUsing(windowValidator)
    await Setting.setMany({
      login_window_enabled: data.enabled ? '1' : '0',
      login_window_start: data.start,
      login_window_end: data.end,
      login_window_days: data.days.join(','),
      login_window_timezone: data.timezone,
    })
    session.flash('status', 'Operating hours saved.')
    return response.redirect().back()
  }
}
