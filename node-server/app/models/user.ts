import { UserSchema } from '#database/schema'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import { column, hasMany, hasOne } from '@adonisjs/lucid/orm'
import type { HasMany, HasOne } from '@adonisjs/lucid/types/relations'
import adminConfig from '#config/admin'
import Score from '#models/score'
import World, { type WorldMetaJson } from '#models/world'
import Device from '#models/device'

const AuthFinder = withAuthFinder(() => hash.use(), {
  uids: ['email'],
  passwordColumnName: 'password',
})

/** what both clients see of the signed-in account */
export type UserPayload = {
  id: number
  name: string
  email: string
  is_admin: boolean
}

export default class User extends compose(UserSchema, AuthFinder) {
  // SQLite stores booleans as 0 / 1
  @column({ consume: (v) => Boolean(v) })
  declare isAdmin: boolean

  @column({ consume: (v) => Boolean(v) })
  declare isDisabled: boolean

  /** bearer tokens for the native client (the browser uses the session) */
  static accessTokens = DbAccessTokensProvider.forModel(User, { table: 'auth_access_tokens' })

  @hasMany(() => Score)
  declare scores: HasMany<typeof Score>

  /** the player's own world (the global world has no owner) */
  @hasOne(() => World, { onQuery: (q) => q.where('kind', World.OWN) })
  declare world: HasOne<typeof World>

  @hasMany(() => World)
  declare worlds: HasMany<typeof World>

  @hasMany(() => Device)
  declare devices: HasMany<typeof Device>

  /** the account named by ADMIN_EMAIL is always an admin, so it cannot lock itself out */
  isEnvAdmin(): boolean {
    const email = adminConfig.email
    return email !== '' && email.toLowerCase() === this.email.toLowerCase()
  }

  /** the `is_admin` flag, or the ADMIN_EMAIL account */
  hasAdminRights(): boolean {
    return this.isAdmin || this.isEnvAdmin()
  }

  payload(): UserPayload {
    return { id: this.id, name: this.name, email: this.email, is_admin: this.hasAdminRights() }
  }

  /** the player's own world and the shared global one */
  async worldsMeta(): Promise<{ own: WorldMetaJson | null; global: WorldMetaJson | null }> {
    const own = await World.query().where('user_id', this.id).where('kind', World.OWN).first()
    const global = await World.global()
    return { own: own?.meta() ?? null, global: global?.meta() ?? null }
  }
}
