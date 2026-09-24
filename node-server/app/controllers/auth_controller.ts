import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import adminConfig from '#config/admin'
import User from '#models/user'
import AccessPolicy from '#services/access_policy'
import { failValidation } from '#support/validation'

const loginValidator = vine.create({
  email: vine.string().email(),
  password: vine.string(),
})

export const GUEST_EMAIL = 'guest@localhost'
export const GUEST_NAME = 'Guest'

/**
 * The account behind these credentials, or a validation error on `email`. The lookup
 * hashes even when the email is unknown, so timing does not reveal which accounts exist.
 */
export async function verifiedUser(email: string, password: string): Promise<User> {
  try {
    return await User.verifyCredentials(email, password)
  } catch {
    failValidation('email', 'Wrong email or password.')
  }
}

/**
 * Session auth for the Inertia app. The app is login-only: guests see the Login page,
 * and a successful sign-in lands on the game page — unless the AccessPolicy says
 * otherwise: a closed login window or a disabled account is refused, and a browser no
 * admin has approved yet is parked on /pending-approval. Accounts are created by an
 * admin; there is no registration or password reset.
 *
 * In development only, the sign-in page also offers a one-click guest account: the
 * first click creates it, every click signs in as it, and the browser is approved on
 * the spot so the game is reachable without an admin.
 */
export default class AuthController {
  async show({ inertia }: HttpContext) {
    const guestLogin = adminConfig.guestLogin
    return inertia.render('Login', {
      guestLogin,
      guestExists: guestLogin && (await User.findBy('email', GUEST_EMAIL)) !== null,
    })
  }

  async login(ctx: HttpContext) {
    const data = await ctx.request.validateUsing(loginValidator)
    // check the credentials without opening a session: the gates below may still refuse
    return this.admit(ctx, await verifiedUser(data.email, data.password))
  }

  /** dev only: create the guest account on first use, then sign in as it, skipping the gates */
  async guest(ctx: HttpContext) {
    if (!adminConfig.guestLogin) return ctx.response.notFound()

    const user = await User.firstOrCreate({ email: GUEST_EMAIL }, { name: GUEST_NAME, password: 'guest' })
    if (user.isDisabled) failValidation('email', 'The guest account has been disabled.')

    // no admin around in dev: this browser is approved for the guest right now
    const device = await AccessPolicy.device(ctx, user)
    if (!device.isApproved()) {
      device.merge({ approvedAt: DateTime.now(), label: 'dev guest' })
      await device.save()
    }
    return this.signIn(ctx, user)
  }

  async logout({ auth, session, response }: HttpContext) {
    await auth.use('web').logout()
    session.regenerate()
    return response.redirect('/login')
  }

  /** credentials are good — open the session if the policy allows it */
  private async admit(ctx: HttpContext, user: User) {
    const reason = await AccessPolicy.blockedReason(user)
    if (reason) failValidation('email', reason)

    const device = await AccessPolicy.device(ctx, user)
    if (!AccessPolicy.deviceAllowed(user, device)) return ctx.response.redirect('/pending-approval')
    return this.signIn(ctx, user)
  }

  private async signIn(ctx: HttpContext, user: User) {
    await ctx.auth.use('web').login(user)
    user.lastLoginAt = DateTime.now()
    await user.save()
    return ctx.response.redirect('/')
  }
}
