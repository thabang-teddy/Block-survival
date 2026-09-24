import type { HttpContext } from '@adonisjs/core/http'
import rooms, { RoomRefusal } from '#game-server/registry'

/** Reset the shared global world: everyone's builds go; the next player to enter starts a fresh map. */
export default class GlobalWorldController {
  async handle({ response, session }: HttpContext) {
    try {
      await rooms.resetGlobal()
      session.flash('status', 'The global world was reset.')
    } catch (e) {
      if (!(e instanceof RoomRefusal)) throw e
      session.flash('status', e.message)
    }
    return response.redirect().back()
  }
}
