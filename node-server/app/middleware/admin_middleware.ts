import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type User from '#models/user'

/** The admin section is for admins only; everyone else gets a 403, never a redirect. */
export default class AdminMiddleware {
  handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.user as User | undefined
    if (!user?.hasAdminRights()) return ctx.response.forbidden('Admins only.')
    return next()
  }
}
