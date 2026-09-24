import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import Device from '#models/device'
import User from '#models/user'
import AccessPolicy from '#services/access_policy'
import db from '@adonisjs/lucid/services/db'
import { verifiedUser } from '#controllers/auth_controller'

const tokenValidator = vine.create({
  email: vine.string().email(),
  password: vine.string(),
  device: vine.object({
    token: vine.string().regex(Device.TOKEN_PATTERN),
    name: vine.string().maxLength(40),
  }),
})

/**
 * Token sign-in for the native client (docs/flutter-client-plan.md D2 / S5).
 *
 * The client cannot hold the browser's session cookie, so it exchanges the same
 * credentials for a bearer token. The three gates of the AccessPolicy apply exactly as
 * they do to a browser. The native client generates its own 64-char device token once
 * and sends it with every sign-in, so the row it creates shows up on the admin's device
 * page like any other PC. No token is issued until that row is approved; the client
 * polls `status`.
 */
export default class ApiAuthController {
  /** credentials + device → token, or 403 while the device waits for approval */
  async token(ctx: HttpContext) {
    const data = await ctx.request.validateUsing(tokenValidator)
    const user = await verifiedUser(data.email, data.password)

    const reason = await AccessPolicy.blockedReason(user)
    if (reason) return ctx.response.forbidden({ message: reason })

    const device = await AccessPolicy.deviceForToken(ctx, data.device.token, data.device.name, user)
    if (!AccessPolicy.deviceAllowed(user, device)) {
      return ctx.response.forbidden({
        message: 'This device is waiting for admin approval.',
        pending: true,
        device: { id: device.id, approved: false },
      })
    }

    user.lastLoginAt = DateTime.now()
    await user.save()
    const token = await User.accessTokens.create(user, ['*'], { name: data.device.name })
    // the access middleware finds the device through its token
    await db.from('auth_access_tokens').where('id', Number(token.identifier)).update({ device_id: device.id })

    return ctx.response.created({ token: token.value!.release(), user: user.payload() })
  }

  /** approval state of a device token, for the client to poll while parked (POST: the token stays out of URLs and logs) */
  async status({ request }: HttpContext) {
    const device = await Device.findByToken(request.input('device'))
    return { known: device !== null, approved: device?.isApproved() ?? false }
  }

  /** who the token belongs to, plus the worlds they can load */
  async me({ auth }: HttpContext) {
    const user = auth.user as User
    return { user: user.payload(), worlds: await user.worldsMeta() }
  }

  /** revoke the token that made the request */
  async logout(ctx: HttpContext) {
    const tokenId = AccessPolicy.currentTokenId(ctx)
    if (tokenId !== null) await User.accessTokens.delete(ctx.auth.user as User, tokenId)
    return ctx.response.noContent()
  }
}
