import type { HttpContext } from '@adonisjs/core/http'
import AccessPolicy from '#services/access_policy'

/**
 * Where a signed-in-but-unapproved browser waits. The page polls `status` and sends the
 * player back to /login once an admin has approved the device.
 */
export default class PendingApprovalController {
  async show(ctx: HttpContext) {
    const device = await AccessPolicy.knownDevice(ctx)
    if (!device) return ctx.response.redirect('/login')
    return ctx.inertia.render('PendingApproval', { device: { id: device.id, approved: device.isApproved() } })
  }

  async status(ctx: HttpContext) {
    const device = await AccessPolicy.knownDevice(ctx)
    return { known: device !== null, approved: device?.isApproved() ?? false }
  }
}
