import vine from '@vinejs/vine';
import Room from '#models/room';
import RoomSignal from '#models/room_signal';
const PEER_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_BYTES = 16 * 1024;
const storeValidator = vine.create({
    from: vine.string().regex(PEER_ID),
    to: vine.string().regex(PEER_ID),
    type: vine.enum(['offer', 'answer', 'candidate']),
    data: vine.object({}).allowUnknownProperties(),
});
const indexValidator = vine.create({
    to: vine.string().regex(PEER_ID),
    after: vine.number().withoutDecimals().min(0).optional(),
});
export default class SignalController {
    async store(ctx) {
        const code = String(ctx.params.code).toUpperCase();
        if (await refused(ctx, code))
            return;
        const data = await ctx.request.validateUsing(storeValidator);
        const json = JSON.stringify(rawData(ctx) ?? data.data);
        if (Buffer.byteLength(json) > MAX_BYTES)
            return ctx.response.status(413).send({ message: 'Signal too large.' });
        const signal = await RoomSignal.create({ roomCode: code, fromPeer: data.from, toPeer: data.to, type: data.type, data: json });
        return ctx.response.created({ id: signal.id });
    }
    async index(ctx) {
        const code = String(ctx.params.code).toUpperCase();
        if (await refused(ctx, code))
            return;
        const q = await ctx.request.validateUsing(indexValidator, { data: ctx.request.qs() });
        const signals = await RoomSignal.query()
            .where('room_code', code)
            .where('to_peer', q.to)
            .where('id', '>', q.after ?? 0)
            .orderBy('id')
            .limit(RoomSignal.PAGE);
        return { signals: signals.map((s) => s.toPublic()) };
    }
}
function rawData(ctx) {
    try {
        const body = JSON.parse(ctx.request.raw() ?? '');
        return body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : null;
    }
    catch {
        return null;
    }
}
async function refused({ response, auth }, code) {
    const room = await Room.findLive(code);
    if (!room) {
        response.notFound({ message: 'No game with that code.' });
        return true;
    }
    if (!(await room.admits(auth.user))) {
        response.forbidden({ message: 'You need an invitation to join this game.' });
        return true;
    }
    return false;
}
//# sourceMappingURL=signal_controller.js.map