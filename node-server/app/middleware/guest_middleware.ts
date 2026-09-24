import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/** a signed-in browser has no business on the sign-in pages */
export default class GuestMiddleware {
  redirectTo = '/'

  async handle(ctx: HttpContext, next: NextFn) {
    if (await ctx.auth.use('web').check()) {
      ctx.session.reflash()
      return ctx.response.redirect(this.redirectTo, true)
    }
    return next()
  }
}
