import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import Device from '#models/device'
import type User from '#models/user'
import { iso } from '#support/time'

const labelValidator = vine.create({
  label: vine.string().maxLength(40).nullable().optional(),
})

/**
 * Approve or forget browsers. Rejecting a pending device and revoking an approved one
 * are the same thing: the row goes, and the next sign-in from that browser creates a
 * fresh pending device.
 */
export default class DeviceController {
  async index({ inertia }: HttpContext) {
    await Device.pruneStale()
    // pending first, then most recently seen
    const devices = await Device.query().preload('user').orderByRaw('approved_at IS NULL DESC').orderBy('last_seen_at', 'desc')
    return inertia.render('Admin/Devices', {
      devices: devices.map((d) => ({
        id: d.id,
        label: d.label,
        user: d.user ? { id: d.user.id, name: d.user.name, email: d.user.email } : null,
        user_agent: d.userAgent,
        ip: d.ip,
        first_seen_at: iso(d.createdAt),
        last_seen_at: iso(d.lastSeenAt),
        approved_at: iso(d.approvedAt),
      })),
    })
  }

  async approve({ params, response, session, auth }: HttpContext) {
    const device = await Device.findOrFail(params.device)
    device.merge({ approvedAt: DateTime.now(), approvedBy: (auth.user as User).id })
    await device.save()
    session.flash('status', `Device #${device.id} approved.`)
    return response.redirect().back()
  }

  async update({ params, request, response }: HttpContext) {
    const device = await Device.findOrFail(params.device)
    const data = await request.validateUsing(labelValidator)
    device.label = data.label || null
    await device.save()
    return response.redirect().back()
  }

  async destroy({ params, response, session }: HttpContext) {
    const device = await Device.findOrFail(params.device)
    await device.delete()
    session.flash('status', `Device #${device.id} removed.`)
    return response.redirect().back()
  }
}
