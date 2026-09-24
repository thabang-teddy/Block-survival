import { DateTime } from 'luxon';
import vine from '@vinejs/vine';
import Room from '#models/room';
import RoomSignal from '#models/room_signal';
import { MAX_PLAYERS } from '#game/net/limits';
const peerId = () => vine.string().maxLength(128).notIn([Room.SERVER_HOST]);
const storeValidator = vine.create({
    code: vine.string().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/),
    host_peer_id: peerId(),
    host_name: vine.string().maxLength(16),
    world_kind: vine.enum(['own', 'global']).optional(),
});
const updateValidator = vine.create({
    host_peer_id: peerId(),
    players: vine.number().withoutDecimals().range([1, MAX_PLAYERS]),
    user_ids: vine.array(vine.number().withoutDecimals()).maxLength(MAX_PLAYERS).optional(),
});
const destroyValidator = vine.create({ host_peer_id: peerId() });
export default class RoomController {
    async store({ request, response, auth }) {
        const data = await request.validateUsing(storeValidator);
        if (data.world_kind === 'global') {
            return response.conflict({ message: 'The global world is hosted by the server — enter it from the web client.' });
        }
        const existing = await Room.findBy('code', data.code);
        const taken = existing && (existing.isServerHosted() || (existing.expiresAt > DateTime.now() && existing.hostPeerId !== data.host_peer_id));
        if (taken) {
            return response.conflict({ message: 'That room code is in use.' });
        }
        await RoomSignal.pruneStale();
        const room = await Room.updateOrCreate({ code: data.code }, {
            hostPeerId: data.host_peer_id,
            hostName: data.host_name,
            worldKind: 'own',
            userId: auth.user?.id ?? null,
            players: 1,
            expiresAt: Room.freshExpiry(),
        });
        return response.created({ room: room.toPublic() });
    }
    async show({ params, response, auth }) {
        const room = await Room.findLive(String(params.code));
        if (!room)
            return response.notFound({ message: 'No game with that code.' });
        if (!(await room.admits(auth.user))) {
            return response.forbidden({ message: 'You need an invitation to join this game.' });
        }
        return { room: room.toPublic() };
    }
    async update({ params, request, response }) {
        const data = await request.validateUsing(updateValidator);
        const room = await Room.query().where('code', String(params.code).toUpperCase()).where('host_peer_id', data.host_peer_id).first();
        if (!room)
            return response.notFound({ message: 'Not your room.' });
        room.merge({ players: data.players, expiresAt: Room.freshExpiry() });
        await room.save();
        return { room: room.toPublic() };
    }
    async destroy({ params, request }) {
        const data = await request.validateUsing(destroyValidator);
        const room = await Room.query().where('code', String(params.code).toUpperCase()).where('host_peer_id', data.host_peer_id).first();
        if (room) {
            await RoomSignal.query().where('room_code', room.code).delete();
            await room.delete();
        }
        return { ok: true };
    }
}
//# sourceMappingURL=room_controller.js.map