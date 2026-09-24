import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import Room from '#models/room'
import RoomSignal from '#models/room_signal'
import type User from '#models/user'

const PEER_ID = /^[A-Za-z0-9_-]{8,64}$/
const MAX_BYTES = 16 * 1024

const storeValidator = vine.create({
  from: vine.string().regex(PEER_ID),
  to: vine.string().regex(PEER_ID),
  type: vine.enum(['offer', 'answer', 'candidate']),
  // an SDP or an RTCIceCandidateInit; kept opaque, size-limited
  data: vine.object({}).allowUnknownProperties(),
})

const indexValidator = vine.create({
  to: vine.string().regex(PEER_ID),
  after: vine.number().withoutDecimals().min(0).optional(),
})

/**
 * WebRTC signalling over plain HTTP, for native clients hosting peer-to-peer: peers POST
 * offers, answers and ICE candidates into the room's mailbox and poll for the ones
 * addressed to them.
 */
export default class SignalController {
  async store(ctx: HttpContext) {
    const code = String(ctx.params.code).toUpperCase()
    if (await refused(ctx, code)) return

    const data = await ctx.request.validateUsing(storeValidator)
    // the body parser trims every string, but an SDP must keep its trailing CRLF (Chrome
    // rejects the last line without it), so the payload is stored from the raw body
    const json = JSON.stringify(rawData(ctx) ?? data.data)
    if (Buffer.byteLength(json) > MAX_BYTES) return ctx.response.status(413).send({ message: 'Signal too large.' })

    const signal = await RoomSignal.create({ roomCode: code, fromPeer: data.from, toPeer: data.to, type: data.type, data: json })
    return ctx.response.created({ id: signal.id })
  }

  /** everything addressed to `to` with an id past `after`, oldest first */
  async index(ctx: HttpContext) {
    const code = String(ctx.params.code).toUpperCase()
    if (await refused(ctx, code)) return

    const q = await ctx.request.validateUsing(indexValidator, { data: ctx.request.qs() })
    const signals = await RoomSignal.query()
      .where('room_code', code)
      .where('to_peer', q.to)
      .where('id', '>', q.after ?? 0)
      .orderBy('id')
      .limit(RoomSignal.PAGE)
    return { signals: signals.map((s) => s.toPublic()) }
  }
}

/** `data` exactly as the client sent it, or null when the body is not JSON */
function rawData(ctx: HttpContext): Record<string, unknown> | null {
  try {
    const body = JSON.parse(ctx.request.raw() ?? '') as { data?: unknown }
    return body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? (body.data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * The mailbox is for the host and accepted invitees only (issue #5). True when the
 * request was refused (the answer is already set); the response helpers return nothing,
 * so the caller must stop on this flag.
 */
async function refused({ response, auth }: HttpContext, code: string): Promise<boolean> {
  const room = await Room.findLive(code)
  if (!room) {
    response.notFound({ message: 'No game with that code.' })
    return true
  }
  if (!(await room.admits(auth.user as User))) {
    response.forbidden({ message: 'You need an invitation to join this game.' })
    return true
  }
  return false
}
