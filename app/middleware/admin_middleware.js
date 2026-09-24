export default class AdminMiddleware {
    handle(ctx, next) {
        const user = ctx.auth.user;
        if (!user?.hasAdminRights())
            return ctx.response.forbidden('Admins only.');
        return next();
    }
}
//# sourceMappingURL=admin_middleware.js.map