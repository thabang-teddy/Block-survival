import { readFile } from 'node:fs/promises'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import type User from '#models/user'
import World from '#models/world'
import { readBody, storeWorld } from '#services/world_store'
import rooms from '#game-server/registry'

const metaValidator = vine.create({
  night: vine.number().withoutDecimals().min(0).optional(),
  seconds: vine.number().withoutDecimals().min(0).optional(),
})

/**
 * Saved worlds. The rooms this server runs save themselves; these endpoints serve a
 * native client that hosts its own world peer-to-peer. It uploads the world as gzipped
 * JSON in the request body (or, from a closing page, as a multipart beacon) and GET
 * streams the same bytes back. The shared global world is only ever written by the
 * server's own room.
 */
export default class WorldController {
  async update(ctx: HttpContext) {
    const refused = refusal(ctx)
    if (refused) return refused
    const meta = await ctx.request.validateUsing(metaValidator, { data: ctx.request.qs() })
    const bytes = await readBody(ctx.request.request, World.MAX_BYTES)
    return store(ctx, bytes, meta)
  }

  /** `navigator.sendBeacon` on unload: multipart with the gzip as a file */
  async beacon(ctx: HttpContext) {
    const refused = refusal(ctx)
    if (refused) return refused
    const meta = await ctx.request.validateUsing(metaValidator)
    const file = ctx.request.file('payload')
    if (!file?.tmpPath) return ctx.response.unprocessableEntity({ message: 'The payload field is required.', errors: { payload: ['The payload field is required.'] } })
    return store(ctx, await readFile(file.tmpPath), meta)
  }

  async show({ params, response, auth }: HttpContext) {
    const kind = params.kind ?? World.OWN
    if (!World.isKind(kind)) return response.notFound({ message: 'Not Found' })
    const world = kind === World.GLOBAL ? await World.global() : await World.ownOf((auth.user as User).id)
    if (!world) return response.notFound({ message: 'No world yet.' })

    response.header('Content-Type', 'application/gzip')
    response.header('X-Save-Night', String(world.night))
    response.header('X-Save-Seconds', String(world.seconds))
    return response.send(world.bytes())
  }

  /** start over in the player's own world: the next save creates a fresh one (the global world is reset by an admin) */
  async destroy({ auth }: HttpContext) {
    const user = auth.user as User
    // a world that is running would only save itself again
    await rooms.closeOwn(user.id, 'The world was reset.', { save: false })
    await World.query().where('user_id', user.id).where('kind', World.OWN).delete()
    return { ok: true }
  }
}

/** uploads the server would overwrite (or that are its to make) are refused up front */
function refusal({ params, response, auth }: HttpContext) {
  const kind = params.kind ?? World.OWN
  if (!World.isKind(kind)) return response.notFound({ message: 'Not Found' })
  if (kind === World.GLOBAL) return response.conflict({ message: 'The global world is hosted by the server.' })
  if (rooms.ownRoomOf((auth.user as User).id)) {
    return response.conflict({ message: 'Your world is running on the server right now — leave it before saving from here.' })
  }
  return null
}

async function store({ response, auth }: HttpContext, bytes: Buffer | null, meta: { night?: number; seconds?: number }) {
  const result = await storeWorld((auth.user as User).id, World.OWN, bytes, meta.night ?? 0, meta.seconds ?? 0)
  if ('error' in result) return response.status(result.status).send({ message: result.error })
  return { world: result.world.meta() }
}
