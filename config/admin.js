import env from '#start/env';
import app from '@adonisjs/core/services/app';
const adminConfig = {
    email: env.get('ADMIN_EMAIL') ?? '',
    password: env.get('ADMIN_PASSWORD') ?? '',
    name: env.get('ADMIN_NAME') ?? 'Admin',
    deviceCookie: 'bs_device',
    devicePendingDays: 30,
    guestLogin: env.get('GUEST_LOGIN') ?? app.inDev,
};
export default adminConfig;
//# sourceMappingURL=admin.js.map