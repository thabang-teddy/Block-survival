import { SaveSchema } from '#database/schema'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import { iso } from '#support/time'

export type WorldKind = 'own' | 'global'

/** summary of a saved world, as the lobby and the admin show it */
export type WorldMetaJson = {
  kind: WorldKind
  size: number
  night: number
  seconds: number
  players: number
  updated_at: string | null
}

/**
 * A saved world (table `saves`): gzipped JSON, base64 in the row. Every player has their
 * own world (`own`, a random seed, `user_id` set); the shared global world (`global`,
 * the classic seed) is one row with no owner.
 */
export default class World extends SaveSchema {
  static table = 'saves'

  /** gzipped payload limit (bytes): v3 saves also hold every visitor's gear and the live world */
  static readonly MAX_BYTES = 4 * 1024 * 1024
  static readonly OWN: WorldKind = 'own'
  static readonly GLOBAL: WorldKind = 'global'
  static readonly KINDS: readonly WorldKind[] = ['own', 'global']

  @column({ serializeAs: null })
  declare payload: string

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  static isKind(kind: string): kind is WorldKind {
    return (World.KINDS as readonly string[]).includes(kind)
  }

  /** the shared global world's row, or null before its first save */
  static global(): Promise<World | null> {
    return World.query().whereNull('user_id').where('kind', World.GLOBAL).first()
  }

  /** a player's own world, or null before its first save */
  static ownOf(userId: number): Promise<World | null> {
    return World.query().where('user_id', userId).where('kind', World.OWN).first()
  }

  /** the gzipped bytes */
  bytes(): Buffer {
    return Buffer.from(this.payload, 'base64')
  }

  meta(): WorldMetaJson {
    return {
      kind: this.kind as WorldKind,
      size: this.size,
      night: this.night,
      seconds: this.seconds,
      players: this.players ?? 1,
      updated_at: iso(this.updatedAt),
    }
  }
}
