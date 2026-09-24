import { randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import { DeviceSchema } from '#database/schema'
import { belongsTo, scope } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import adminConfig from '#config/admin'
import User from '#models/user'
import { sqlTime } from '#support/time'

const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/**
 * A browser ("PC") or native client that has signed in. A browser is identified by a
 * random token kept in an encrypted cookie; an admin has to approve it before its user
 * may play.
 */
export default class Device extends DeviceSchema {
  static readonly TOKEN_LENGTH = 64
  static readonly TOKEN_PATTERN = /^[A-Za-z0-9]{64}$/

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'approvedBy' })
  declare approver: BelongsTo<typeof User>

  static approved = scope((query) => {
    query.whereNotNull('approved_at')
  })

  static pending = scope((query) => {
    query.whereNull('approved_at')
  })

  isApproved(): boolean {
    return this.approvedAt !== null
  }

  static newToken(): string {
    const bytes = randomBytes(Device.TOKEN_LENGTH)
    return Array.from(bytes, (b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join('')
  }

  /** a cookie / request value is only trusted if it looks like a token and exists */
  static async findByToken(token: unknown): Promise<Device | null> {
    if (typeof token !== 'string' || !Device.TOKEN_PATTERN.test(token)) return null
    return Device.findBy('token', token)
  }

  static async pendingCount(): Promise<number> {
    const [row] = await Device.query().withScopes((s) => s.pending()).count('* as n')
    return Number(row.$extras.n)
  }

  static async approvedCount(): Promise<number> {
    const [row] = await Device.query().withScopes((s) => s.approved()).count('* as n')
    return Number(row.$extras.n)
  }

  /** forget browsers nobody approved; swept when the admin section is opened */
  static async pruneStale(): Promise<void> {
    const cutoff = DateTime.now().minus({ days: adminConfig.devicePendingDays })
    await Device.query().withScopes((s) => s.pending()).where('created_at', '<', sqlTime(cutoff)).delete()
  }
}
