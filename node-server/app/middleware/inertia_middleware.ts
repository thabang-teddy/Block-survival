import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import BaseInertiaMiddleware from '@adonisjs/inertia/inertia_middleware'
import type User from '#models/user'
import Device from '#models/device'

/** Props shared with every page — the same ones the Laravel app shared. */
export default class InertiaMiddleware extends BaseInertiaMiddleware {
  async share(ctx: HttpContext) {
    const { auth, session } = ctx as Partial<HttpContext>
    const user = auth?.user as User | undefined
    // the admin nav badge; only computed inside the admin section
    const pendingDevices =
      ctx.request.url().startsWith('/admin') && user?.hasAdminRights() ? await Device.pendingCount() : 0
    return {
      errors: ctx.inertia.always(this.getValidationErrors(ctx)),
      auth: ctx.inertia.always({ user: user ? user.payload() : null }),
      flash: ctx.inertia.always({ status: (session?.flashMessages.get('status') as string | undefined) ?? null }),
      pendingDevices: ctx.inertia.always(pendingDevices),
    }
  }

  async handle(ctx: HttpContext, next: NextFn) {
    await this.init(ctx)
    const output = await next()
    this.dispose(ctx)
    return output
  }
}
