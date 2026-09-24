import type { HttpContext } from '@adonisjs/core/http'
import Room from '#models/room'
import RoomSignal from '#models/room_signal'
import { iso } from '#support/time'
import rooms from '#game-server/registry'

/** Live rooms, with a force-close: a room this server runs sends its players back to the lobby. */
export default class RoomController {
  async index({ inertia }: HttpContext) {
    const live = await Room.query().withScopes((s) => s.live()).withCount('invites').orderBy('created_at', 'desc')
    return inertia.render('Admin/Rooms', {
      rooms: live.map((r) => ({
        code: r.code,
        host_name: r.hostName,
        world_kind: r.worldKind,
        players: r.players,
        invites: Number(r.$extras.invites_count ?? 0),
        expires_at: iso(r.expiresAt),
      })),
    })
  }

  async destroy({ params, response, session }: HttpContext) {
    const code = String(params.code).toUpperCase()
    if (rooms.running(code)) {
      await rooms.close(code, 'An admin closed this game.')
    } else {
      await Room.query().where('code', code).delete()
      await RoomSignal.query().where('room_code', code).delete()
    }
    session.flash('status', `Room ${code} closed.`)
    return response.redirect().back()
  }
}
