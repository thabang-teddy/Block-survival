import { DateTime } from 'luxon';
import vine from '@vinejs/vine';
import Room from '#models/room';
import RoomInvite from '#models/room_invite';
import User from '#models/user';
import { MAX_PLAYERS } from '#game/net/limits';
import { sqlTime } from '#support/time';
const inviteValidator = vine.create({
    user_id: vine.number().withoutDecimals().exists({ table: 'users', column: 'id' }),
});
function hostView(invite, name) {
    return { id: invite.id, user_id: invite.toUserId, name: name ?? 'Unknown', status: invite.status };
}
export default class InviteController {
    async players({ auth }) {
        const me = auth.user;
        const users = await User.query().whereNot('id', me.id).where('is_disabled', false).orderBy('name').select('id', 'name');
        return { players: users.map((u) => ({ id: u.id, name: u.name })) };
    }
    async store({ params, request, response, auth }) {
        const me = auth.user;
        const room = await Room.findLive(String(params.code));
        if (!room)
            return response.notFound({ message: 'No game with that code.' });
        if (!room.isHostedBy(me))
            return response.forbidden({ message: 'Only the host can invite players.' });
        const data = await request.validateUsing(inviteValidator);
        if (data.user_id === me.id)
            return response.unprocessableEntity({ message: 'You are already in your own game.' });
        const existing = await RoomInvite.query().where('room_id', room.id).where('to_user_id', data.user_id).first();
        const invite = existing ?? new RoomInvite().merge({ roomId: room.id, toUserId: data.user_id });
        if (!existing || invite.status === RoomInvite.DECLINED) {
            invite.merge({ fromUserId: me.id, status: RoomInvite.PENDING });
            await invite.save();
        }
        const to = await User.find(invite.toUserId);
        return response.status(existing ? 200 : 201).send({ invite: hostView(invite, to?.name ?? null) });
    }
    async room({ params, response, auth }) {
        const room = await Room.findLive(String(params.code));
        if (!room)
            return response.notFound({ message: 'No game with that code.' });
        if (!room.isHostedBy(auth.user))
            return response.forbidden({ message: 'Not your room.' });
        const invites = await RoomInvite.query().where('room_id', room.id).preload('to').orderBy('id');
        return { invites: invites.map((i) => hostView(i, i.to?.name ?? null)) };
    }
    async index({ auth }) {
        const me = auth.user;
        const invites = await RoomInvite.query()
            .withScopes((s) => s.pending())
            .where('to_user_id', me.id)
            .whereHas('room', (q) => q.where('expires_at', '>', sqlTime(DateTime.now())).where('players', '<', MAX_PLAYERS))
            .preload('room')
            .orderBy('id', 'desc');
        return { invites: invites.map((i) => i.toPublic()) };
    }
    async accept({ params, response, auth }) {
        const invite = await RoomInvite.find(params.invite);
        if (!invite)
            return response.notFound({ message: 'Not Found' });
        if (invite.toUserId !== auth.user.id)
            return response.forbidden({ message: 'Not your invite.' });
        await invite.load('room');
        const room = invite.room;
        if (!room || room.expiresAt <= DateTime.now())
            return response.gone({ message: 'That game is over.' });
        if (invite.status === RoomInvite.DECLINED)
            return response.conflict({ message: 'You declined this invite.' });
        invite.status = RoomInvite.ACCEPTED;
        await invite.save();
        return { invite: invite.toPublic(), room: room.toPublic() };
    }
    async decline({ params, response, auth }) {
        const invite = await RoomInvite.find(params.invite);
        if (!invite)
            return response.notFound({ message: 'Not Found' });
        if (invite.toUserId !== auth.user.id)
            return response.forbidden({ message: 'Not your invite.' });
        invite.status = RoomInvite.DECLINED;
        await invite.save();
        return { ok: true };
    }
}
//# sourceMappingURL=invite_controller.js.map