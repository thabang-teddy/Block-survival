import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import Room from '#models/room'
import RoomInvite from '#models/room_invite'
import User from '#models/user'
import { MAX_PLAYERS } from '#game/net/limits'
import { sqlTime } from '#support/time'

const inviteValidator = vine.create({
  user_id: vine.number().withoutDecimals().exists({ table: 'users', column: 'id' }),
})

/** the host's view of one invitation */
function hostView(invite: RoomInvite, name: string | null) {
  return { id: invite.id, user_id: invite.toUserId, name: name ?? 'Unknown', status: invite.status }
}

/**
 * Invitations (issue #5): the only way into someone else's world. The host picks
 * players by name from the pause screen; the invitee sees the invite in the lobby and
 * accepts it.
 */
export default class InviteController {
  /** every other enabled player, for the host's invite list */
  async players({ auth }: HttpContext) {
    const me = auth.user as User
    const users = await User.query().whereNot('id', me.id).where('is_disabled', false).orderBy('name').select('id', 'name')
    return { players: users.map((u) => ({ id: u.id, name: u.name })) }
  }

  /** the host invites one player into their room (re-inviting after a decline is fine) */
  async store({ params, request, response, auth }: HttpContext) {
    const me = auth.user as User
    const room = await Room.findLive(String(params.code))
    if (!room) return response.notFound({ message: 'No game with that code.' })
    if (!room.isHostedBy(me)) return response.forbidden({ message: 'Only the host can invite players.' })
    const data = await request.validateUsing(inviteValidator)
    if (data.user_id === me.id) return response.unprocessableEntity({ message: 'You are already in your own game.' })

    const existing = await RoomInvite.query().where('room_id', room.id).where('to_user_id', data.user_id).first()
    const invite = existing ?? new RoomInvite().merge({ roomId: room.id, toUserId: data.user_id })
    if (!existing || invite.status === RoomInvite.DECLINED) {
      invite.merge({ fromUserId: me.id, status: RoomInvite.PENDING })
      await invite.save()
    }
    const to = await User.find(invite.toUserId)
    return response.status(existing ? 200 : 201).send({ invite: hostView(invite, to?.name ?? null) })
  }

  /** the host's view of who has been invited into a room and where they stand */
  async room({ params, response, auth }: HttpContext) {
    const room = await Room.findLive(String(params.code))
    if (!room) return response.notFound({ message: 'No game with that code.' })
    if (!room.isHostedBy(auth.user as User)) return response.forbidden({ message: 'Not your room.' })

    const invites = await RoomInvite.query().where('room_id', room.id).preload('to').orderBy('id')
    return { invites: invites.map((i) => hostView(i, i.to?.name ?? null)) }
  }

  /** my pending invites into rooms that are still open and have a seat */
  async index({ auth }: HttpContext) {
    const me = auth.user as User
    const invites = await RoomInvite.query()
      .withScopes((s) => s.pending())
      .where('to_user_id', me.id)
      .whereHas('room', (q) => q.where('expires_at', '>', sqlTime(DateTime.now())).where('players', '<', MAX_PLAYERS))
      .preload('room')
      .orderBy('id', 'desc')
    return { invites: invites.map((i) => i.toPublic()) }
  }

  /** accept: the invite is mine and pending; the answer carries the room to join */
  async accept({ params, response, auth }: HttpContext) {
    const invite = await RoomInvite.find(params.invite)
    if (!invite) return response.notFound({ message: 'Not Found' })
    if (invite.toUserId !== (auth.user as User).id) return response.forbidden({ message: 'Not your invite.' })
    await invite.load('room')
    const room = invite.room
    if (!room || room.expiresAt <= DateTime.now()) return response.gone({ message: 'That game is over.' })
    if (invite.status === RoomInvite.DECLINED) return response.conflict({ message: 'You declined this invite.' })

    invite.status = RoomInvite.ACCEPTED
    await invite.save()
    return { invite: invite.toPublic(), room: room.toPublic() }
  }

  async decline({ params, response, auth }: HttpContext) {
    const invite = await RoomInvite.find(params.invite)
    if (!invite) return response.notFound({ message: 'Not Found' })
    if (invite.toUserId !== (auth.user as User).id) return response.forbidden({ message: 'Not your invite.' })
    invite.status = RoomInvite.DECLINED
    await invite.save()
    return { ok: true }
  }
}
