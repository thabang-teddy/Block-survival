import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import adminConfig from '#config/admin'
import Device from '#models/device'
import type User from '#models/user'
import LoginWindow from '#support/login_window'
import db from '@adonisjs/lucid/services/db'

const COOKIE_MAX_AGE = '365d'

/**
 * Who may be signed in right now. Three gates, checked at sign-in and on every
 * authenticated request (and, for players in a running game, periodically by the room):
 * the account is not disabled, the login window is open, and the device has been
 * approved by an admin. Admins pass every gate.
 *
 * A device is a browser (identified by an encrypted cookie) or a native client
 * (identified by the device token it presents at sign-in, then by the access token that
 * was issued for it).
 */
export default class AccessPolicy {
  /** why this user may not be signed in right now, or null if they may */
  static async blockedReason(user: User): Promise<string | null> {
    if (user.isDisabled) return 'This account has been disabled.'
    if (user.hasAdminRights()) return null
    const window = await LoginWindow.fromSettings()
    const now = DateTime.now()
    return window.isOpen(now) ? null : window.describeNextOpening(now)
  }

  /** the browser's device row, created (and its cookie set) on first sight */
  static async device(ctx: HttpContext, user: User | null = null): Promise<Device> {
    let device = await Device.findByToken(ctx.request.encryptedCookie(adminConfig.deviceCookie))
    if (!device) {
      device = await Device.create({ token: Device.newToken() })
      // encrypted, and never readable from JS
      ctx.response.encryptedCookie(adminConfig.deviceCookie, device.token, {
        maxAge: COOKIE_MAX_AGE,
        httpOnly: true,
        sameSite: 'lax',
        secure: ctx.request.secure(),
        path: '/',
      })
    }
    return AccessPolicy.touch(ctx, device, user?.id ?? device.userId)
  }

  /** the native client's device row for its token, created on first sight */
  static async deviceForToken(ctx: HttpContext, token: string, label: string, user: User): Promise<Device> {
    const device = (await Device.findByToken(token)) ?? (await Device.create({ token, label: label.slice(0, 40) }))
    return AccessPolicy.touch(ctx, device, user.id)
  }

  /**
   * The device behind the request without creating one: the one the bearer token was
   * issued for, else the one named by the browser cookie (for the pending page).
   */
  static async knownDevice(ctx: HttpContext): Promise<Device | null> {
    const tokenId = AccessPolicy.currentTokenId(ctx)
    if (tokenId !== null) {
      const row = await db.from('auth_access_tokens').where('id', tokenId).select('device_id').first()
      return row?.device_id ? Device.find(row.device_id) : null
    }
    return Device.findByToken(ctx.request.encryptedCookie(adminConfig.deviceCookie))
  }

  static deviceAllowed(user: User, device: Device | null): boolean {
    return user.hasAdminRights() || (device !== null && device.isApproved())
  }

  /** the id of the access token that authenticated this request, or null for a session */
  static currentTokenId(ctx: HttpContext): number | null {
    if (ctx.auth.authenticatedViaGuard !== 'api') return null
    const user = ctx.auth.user as (User & { currentAccessToken?: { identifier: string | number | bigint } }) | undefined
    const id = user?.currentAccessToken?.identifier
    return id === undefined ? null : Number(id)
  }

  private static async touch(ctx: HttpContext, device: Device, userId: number | null): Promise<Device> {
    device.merge({
      userId,
      userAgent: (ctx.request.header('user-agent') ?? '').slice(0, 255),
      ip: ctx.request.ip(),
      lastSeenAt: DateTime.now(),
    })
    await device.save()
    return device
  }
}
