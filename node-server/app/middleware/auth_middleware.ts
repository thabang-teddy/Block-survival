import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'

/**
 * Only signed-in callers get through. Pages send a guest to /login; the JSON API answers
 * 401 (the exception handler renders it) and accepts the session or a bearer token.
 */
export default class AuthMiddleware {
  redirectTo = '/login'

  async handle(ctx: HttpContext, next: NextFn, options: { guards?: (keyof Authenticators)[] } = {}) {
    await ctx.auth.authenticateUsing(options.guards, { loginRoute: this.redirectTo })
    return next()
  }
}
