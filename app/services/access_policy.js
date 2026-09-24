import { DateTime } from 'luxon';
import adminConfig from '#config/admin';
import Device from '#models/device';
import LoginWindow from '#support/login_window';
import db from '@adonisjs/lucid/services/db';
const COOKIE_MAX_AGE = '365d';
export default class AccessPolicy {
    static async blockedReason(user) {
        if (user.isDisabled)
            return 'This account has been disabled.';
        if (user.hasAdminRights())
            return null;
        const window = await LoginWindow.fromSettings();
        const now = DateTime.now();
        return window.isOpen(now) ? null : window.describeNextOpening(now);
    }
    static async device(ctx, user = null) {
        let device = await Device.findByToken(ctx.request.encryptedCookie(adminConfig.deviceCookie));
        if (!device) {
            device = await Device.create({ token: Device.newToken() });
            ctx.response.encryptedCookie(adminConfig.deviceCookie, device.token, {
                maxAge: COOKIE_MAX_AGE,
                httpOnly: true,
                sameSite: 'lax',
                secure: ctx.request.secure(),
                path: '/',
            });
        }
        return AccessPolicy.touch(ctx, device, user?.id ?? device.userId);
    }
    static async deviceForToken(ctx, token, label, user) {
        const device = (await Device.findByToken(token)) ?? (await Device.create({ token, label: label.slice(0, 40) }));
        return AccessPolicy.touch(ctx, device, user.id);
    }
    static async knownDevice(ctx) {
        const tokenId = AccessPolicy.currentTokenId(ctx);
        if (tokenId !== null) {
            const row = await db.from('auth_access_tokens').where('id', tokenId).select('device_id').first();
            return row?.device_id ? Device.find(row.device_id) : null;
        }
        return Device.findByToken(ctx.request.encryptedCookie(adminConfig.deviceCookie));
    }
    static deviceAllowed(user, device) {
        return user.hasAdminRights() || (device !== null && device.isApproved());
    }
    static currentTokenId(ctx) {
        if (ctx.auth.authenticatedViaGuard !== 'api')
            return null;
        const user = ctx.auth.user;
        const id = user?.currentAccessToken?.identifier;
        return id === undefined ? null : Number(id);
    }
    static async touch(ctx, device, userId) {
        device.merge({
            userId,
            userAgent: (ctx.request.header('user-agent') ?? '').slice(0, 255),
            ip: ctx.request.ip(),
            lastSeenAt: DateTime.now(),
        });
        await device.save();
        return device;
    }
}
//# sourceMappingURL=access_policy.js.map