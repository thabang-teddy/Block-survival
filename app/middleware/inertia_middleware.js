import BaseInertiaMiddleware from '@adonisjs/inertia/inertia_middleware';
import Device from '#models/device';
export default class InertiaMiddleware extends BaseInertiaMiddleware {
    async share(ctx) {
        const { auth, session } = ctx;
        const user = auth?.user;
        const pendingDevices = ctx.request.url().startsWith('/admin') && user?.hasAdminRights() ? await Device.pendingCount() : 0;
        return {
            errors: ctx.inertia.always(this.getValidationErrors(ctx)),
            auth: ctx.inertia.always({ user: user ? user.payload() : null }),
            flash: ctx.inertia.always({ status: session?.flashMessages.get('status') ?? null }),
            pendingDevices: ctx.inertia.always(pendingDevices),
        };
    }
    async handle(ctx, next) {
        await this.init(ctx);
        const output = await next();
        this.dispose(ctx);
        return output;
    }
}
//# sourceMappingURL=inertia_middleware.js.map