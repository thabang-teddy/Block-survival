import vine from '@vinejs/vine';
import Room from '#models/room';
import rooms, { RoomRefusal } from '#game-server/registry';
import AccessPolicy from '#services/access_policy';
const playValidator = vine.create({
    world: vine.enum(['own', 'global']),
});
export default class PlayController {
    async play(ctx) {
        const { request, response, auth } = ctx;
        const { world } = await request.validateUsing(playValidator);
        const user = auth.user;
        try {
            const room = world === 'global' ? await rooms.openGlobal() : await rooms.openOwn(user);
            return { room: room.toPublic(), ticket: await ticketFor(ctx, user, room.code) };
        }
        catch (e) {
            if (e instanceof RoomRefusal)
                return response.status(e.status).send({ message: e.message });
            throw e;
        }
    }
    async join(ctx) {
        const { params, response, auth } = ctx;
        const user = auth.user;
        const room = await Room.findLive(String(params.code));
        if (!room || !room.isServerHosted() || !rooms.running(room.code)) {
            return response.notFound({ message: 'No game with that code.' });
        }
        if (!(await room.admits(user)))
            return response.forbidden({ message: 'You need an invitation to join this game.' });
        return { room: room.toPublic(), ticket: await ticketFor(ctx, user, room.code) };
    }
}
async function ticketFor(ctx, user, code) {
    const device = await AccessPolicy.knownDevice(ctx);
    return rooms.issueTicket(user, code, device?.id ?? null);
}
//# sourceMappingURL=play_controller.js.map