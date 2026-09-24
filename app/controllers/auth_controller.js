import { DateTime } from 'luxon';
import vine from '@vinejs/vine';
import adminConfig from '#config/admin';
import User from '#models/user';
import AccessPolicy from '#services/access_policy';
import { failValidation } from '#support/validation';
const loginValidator = vine.create({
    email: vine.string().email(),
    password: vine.string(),
});
export const GUEST_EMAIL = 'guest@localhost';
export const GUEST_NAME = 'Guest';
export async function verifiedUser(email, password) {
    try {
        return await User.verifyCredentials(email, password);
    }
    catch {
        failValidation('email', 'Wrong email or password.');
    }
}
export default class AuthController {
    async show({ inertia }) {
        const guestLogin = adminConfig.guestLogin;
        return inertia.render('Login', {
            guestLogin,
            guestExists: guestLogin && (await User.findBy('email', GUEST_EMAIL)) !== null,
        });
    }
    async login(ctx) {
        const data = await ctx.request.validateUsing(loginValidator);
        return this.admit(ctx, await verifiedUser(data.email, data.password));
    }
    async guest(ctx) {
        if (!adminConfig.guestLogin)
            return ctx.response.notFound();
        const user = await User.firstOrCreate({ email: GUEST_EMAIL }, { name: GUEST_NAME, password: 'guest' });
        if (user.isDisabled)
            failValidation('email', 'The guest account has been disabled.');
        const device = await AccessPolicy.device(ctx, user);
        if (!device.isApproved()) {
            device.merge({ approvedAt: DateTime.now(), label: 'dev guest' });
            await device.save();
        }
        return this.signIn(ctx, user);
    }
    async logout({ auth, session, response }) {
        await auth.use('web').logout();
        session.regenerate();
        return response.redirect('/login');
    }
    async admit(ctx, user) {
        const reason = await AccessPolicy.blockedReason(user);
        if (reason)
            failValidation('email', reason);
        const device = await AccessPolicy.device(ctx, user);
        if (!AccessPolicy.deviceAllowed(user, device))
            return ctx.response.redirect('/pending-approval');
        return this.signIn(ctx, user);
    }
    async signIn(ctx, user) {
        await ctx.auth.use('web').login(user);
        user.lastLoginAt = DateTime.now();
        await user.save();
        return ctx.response.redirect('/');
    }
}
//# sourceMappingURL=auth_controller.js.map