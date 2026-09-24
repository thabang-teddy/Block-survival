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
    const denied = await gate(ctx, code)
    if (denied) return denied

    const data = await ctx.request.validateUsing(storeValidator)
    // stored verbatim: an SDP must keep its trailing CRLF (Chrome rejects the last line without it)
    const json = JSON.stringify(data.data)
    if (Buffer.byteLength(json) > MAX_BYTES) return ctx.response.status(413).send({ message: 'Signal too large.' })

    const signal = await RoomSignal.create({ roomCode: code, fromPeer: data.from, toPeer: data.to, type: data.type, data: json })
    return ctx.response.created({ id: signal.id })
  }

  /** everything addressed to `to` with an id past `after`, oldest first */
  async index(ctx: HttpContext) {
    const code = String(ctx.params.code).toUpperCase()
    const denied = await gate(ctx, code)
    if (denied) return denied

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

/** the mailbox is for the host and accepted invitees only (issue #5) */
async function gate({ response, auth }: HttpContext, code: string) {
  const room = await Room.findLive(code)
  if (!room) return response.notFound({ message: 'No game with that code.' })
  if (!(await room.admits(auth.user as User))) return response.forbidden({ message: 'You need an invitation to join this game.' })
  return null
}
