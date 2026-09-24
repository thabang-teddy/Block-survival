import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import AccessPolicy from '#services/access_policy'
import User from '#models/user'

/**
 * Ends a sign-in the moment it is no longer allowed: the account was disabled, the
 * login window closed, or an admin revoked this device. Runs on every authenticated
 * route (pages and /api); admins are exempt. A browser loses its session; a native
 * client loses the bearer token it used.
 */
export default class AccessMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.user as User | undefined
    if (!user) return next()

    const reason = await AccessPolicy.blockedReason(user)
    if (reason) return this.endSession(ctx, user, reason, '/login')
    if (!AccessPolicy.deviceAllowed(user, await AccessPolicy.knownDevice(ctx))) {
      return this.endSession(ctx, user, 'This PC is waiting for admin approval.', '/pending-approval')
    }
    return next()
  }

  private async endSession(ctx: HttpContext, user: User, reason: string, to: string) {
    const tokenId = AccessPolicy.currentTokenId(ctx)
    if (tokenId !== null) {
      await User.accessTokens.delete(user, tokenId)
      return ctx.response.forbidden({ message: reason })
    }

    await ctx.auth.use('web').logout()
    ctx.session.regenerate()

    if (ctx.request.url().startsWith('/api/') || ctx.request.accepts(['html', 'json']) === 'json') {
      return ctx.response.forbidden({ message: reason })
    }
    ctx.session.flash('status', reason)
    return ctx.response.redirect(to)
  }
}
