import { DateTime } from 'luxon'
import { RoomSchema } from '#database/schema'
import { hasMany, scope } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import RoomInvite from '#models/room_invite'
import type User from '#models/user'
import type { WorldKind } from '#models/world'
import { iso, sqlTime } from '#support/time'

/** what joiners, the lobby and the admin see of a room */
export type RoomJson = {
  code: string
  host_peer_id: string
  host_name: string
  world_kind: WorldKind
  players: number
  expires_at: string | null
}

/**
 * An open game. Rooms this server hosts carry `host_peer_id` = SERVER_HOST; a native
 * client hosting peer-to-peer registers its WebRTC peer id and refreshes the TTL.
 */
export default class Room extends RoomSchema {
  /** rooms live this long unless their host refreshes them */
  static readonly TTL_HOURS = 2
  /** the `host_peer_id` of a room this server runs */
  static readonly SERVER_HOST = 'server'

  @hasMany(() => RoomInvite)
  declare invites: HasMany<typeof RoomInvite>

  static live = scope((query) => {
    query.where('expires_at', '>', sqlTime(DateTime.now()))
  })

  static findLive(code: string): Promise<Room | null> {
    return Room.query().withScopes((s) => s.live()).where('code', code.toUpperCase()).first()
  }

  static freshExpiry(): DateTime {
    return DateTime.now().plus({ hours: Room.TTL_HOURS })
  }

  isHostedBy(user: User | null | undefined): boolean {
    return !!user && this.userId !== null && this.userId === user.id
  }

  isGlobal(): boolean {
    return this.worldKind === 'global'
  }

  isServerHosted(): boolean {
    return this.hostPeerId === Room.SERVER_HOST
  }

  /**
   * Who may resolve the room and join it: the host, a player holding an accepted invite,
   * or — the global world being open to everyone — anyone at all.
   */
  async admits(user: User | null | undefined): Promise<boolean> {
    if (!user) return false
    if (this.isHostedBy(user) || this.isGlobal()) return true
    const invite = await RoomInvite.query()
      .where('room_id', this.id)
      .where('to_user_id', user.id)
      .where('status', RoomInvite.ACCEPTED)
      .first()
    return invite !== null
  }

  toPublic(): RoomJson {
    return {
      code: this.code,
      host_peer_id: this.hostPeerId,
      host_name: this.hostName,
      world_kind: this.worldKind as WorldKind,
      players: this.players,
      expires_at: iso(this.expiresAt),
    }
  }
}
