import type { HttpContext } from '@adonisjs/core/http'
import rooms from '#game-server/registry'

const HOSTED_BY_SERVER = 'The global world is hosted by the server now — enter it from the web client.'

/**
 * The shared global world. In the Laravel app its players queued up and the front of
 * the queue hosted it peer-to-peer; here the server runs it, so the queue endpoints a
 * native client still calls answer with a refusal it can show (409, as a full world
 * did). The lobby's presence card is served as before.
 */
export default class GlobalWorldController {
  /** who is in the shared world right now — the lobby card (the web page gets this as a prop) */
  async presence() {
    return rooms.presence()
  }

  async join({ response }: HttpContext) {
    return response.conflict({ message: HOSTED_BY_SERVER })
  }

  async claim({ response }: HttpContext) {
    return response.conflict({ message: HOSTED_BY_SERVER })
  }

  async leave() {
    return { ok: true }
  }
}
