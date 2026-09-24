import { DateTime } from 'luxon';
import vine from '@vinejs/vine';
import Device from '#models/device';
import User from '#models/user';
import AccessPolicy from '#services/access_policy';
import db from '@adonisjs/lucid/services/db';
import { verifiedUser } from '#controllers/auth_controller';
const tokenValidator = vine.create({
    email: vine.string().email(),
    password: vine.string(),
    device: vine.object({
        token: vine.string().regex(Device.TOKEN_PATTERN),
        name: vine.string().maxLength(40),
    }),
});
export default class ApiAuthController {
    async token(ctx) {
        const data = await ctx.request.validateUsing(tokenValidator);
        const user = await verifiedUser(data.email, data.password);
        const reason = await AccessPolicy.blockedReason(user);
        if (reason)
            return ctx.response.forbidden({ message: reason });
        const device = await AccessPolicy.deviceForToken(ctx, data.device.token, data.device.name, user);
        if (!AccessPolicy.deviceAllowed(user, device)) {
            return ctx.response.forbidden({
                message: 'This device is waiting for admin approval.',
                pending: true,
                device: { id: device.id, approved: false },
            });
        }
        user.lastLoginAt = DateTime.now();
        await user.save();
        const token = await User.accessTokens.create(user, ['*'], { name: data.device.name });
        await db.from('auth_access_tokens').where('id', Number(token.identifier)).update({ device_id: device.id });
        return ctx.response.created({ token: token.value.release(), user: user.payload() });
    }
    async status({ request }) {
        const device = await Device.findByToken(request.input('device'));
        return { known: device !== null, approved: device?.isApproved() ?? false };
    }
    async me({ auth }) {
        const user = auth.user;
        return { user: user.payload(), worlds: await user.worldsMeta() };
    }
    async logout(ctx) {
        const tokenId = AccessPolicy.currentTokenId(ctx);
        if (tokenId !== null)
            await User.accessTokens.delete(ctx.auth.user, tokenId);
        return ctx.response.noContent();
    }
}
//# sourceMappingURL=auth_controller.js.map