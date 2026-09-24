import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import Room from '#models/room'
import type User from '#models/user'
import rooms, { RoomRefusal } from '#game-server/registry'
import AccessPolicy from '#services/access_policy'

const playValidator = vine.create({
  world: vine.enum(['own', 'global']),
})

/**
 * Getting into a game this server runs. Every answer is a room plus a one-time ticket;
 * the client opens the WebSocket at /ws with that ticket within a few seconds.
 *
 * - `play`: the player's own world (opened on the server if it is not running yet) or
 *   the shared global world.
 * - `join`: a room the player may enter by code — their own, the global one, or one
 *   they hold an accepted invite for. Also how a dropped player reconnects.
 */
export default class PlayController {
  async play(ctx: HttpContext) {
    const { request, response, auth } = ctx
    const { world } = await request.validateUsing(playValidator)
    const user = auth.user as User
    try {
      const room = world === 'global' ? await rooms.openGlobal() : await rooms.openOwn(user)
      return { room: room.toPublic(), ticket: await ticketFor(ctx, user, room.code) }
    } catch (e) {
      if (e instanceof RoomRefusal) return response.status(e.status).send({ message: e.message })
      throw e
    }
  }

  async join(ctx: HttpContext) {
    const { params, response, auth } = ctx
    const user = auth.user as User
    const room = await Room.findLive(String(params.code))
    if (!room || !room.isServerHosted() || !rooms.running(room.code)) {
      return response.notFound({ message: 'No game with that code.' })
    }
    if (!(await room.admits(user))) return response.forbidden({ message: 'You need an invitation to join this game.' })
    return { room: room.toPublic(), ticket: await ticketFor(ctx, user, room.code) }
  }
}

/** a ticket for this player into that room, remembering the device so the room can re-check it */
async function ticketFor(ctx: HttpContext, user: User, code: string): Promise<string> {
  const device = await AccessPolicy.knownDevice(ctx)
  return rooms.issueTicket(user, code, device?.id ?? null)
}
