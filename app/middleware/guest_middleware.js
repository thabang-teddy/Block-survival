export default class GuestMiddleware {
    redirectTo = '/';
    async handle(ctx, next) {
        if (await ctx.auth.use('web').check()) {
            ctx.session.reflash();
            return ctx.response.redirect(this.redirectTo, true);
        }
        return next();
    }
}
//# sourceMappingURL=guest_middleware.js.map