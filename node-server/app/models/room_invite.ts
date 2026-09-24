import { RoomInviteSchema } from '#database/schema'
import { belongsTo, scope } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Room from '#models/room'
import User from '#models/user'
import type { WorldKind } from '#models/world'
import { MAX_PLAYERS } from '#game/net/limits'
import { iso } from '#support/time'

export type InviteStatus = 'pending' | 'accepted' | 'declined'

/** an invitation as the invitee's lobby sees it */
export type InviteJson = {
  id: number
  code: string
  host_name: string
  world_kind: WorldKind
  players: number
  max_players: number
  expires_at: string | null
  status: InviteStatus
}

/**
 * A host asking a player into their room (issue #5). Joining someone's room takes an
 * accepted invite.
 */
export default class RoomInvite extends RoomInviteSchema {
  static readonly PENDING: InviteStatus = 'pending'
  static readonly ACCEPTED: InviteStatus = 'accepted'
  static readonly DECLINED: InviteStatus = 'declined'

  @belongsTo(() => Room)
  declare room: BelongsTo<typeof Room>

  @belongsTo(() => User, { foreignKey: 'fromUserId' })
  declare from: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'toUserId' })
  declare to: BelongsTo<typeof User>

  static pending = scope((query) => {
    query.where('status', RoomInvite.PENDING)
  })

  /** needs `room` preloaded */
  toPublic(): InviteJson {
    const room = this.room
    return {
      id: this.id,
      code: room.code,
      host_name: room.hostName,
      world_kind: room.worldKind as WorldKind,
      players: room.players,
      max_players: MAX_PLAYERS,
      expires_at: iso(room.expiresAt),
      status: this.status as InviteStatus,
    }
  }
}
