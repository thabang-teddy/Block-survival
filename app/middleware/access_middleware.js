import AccessPolicy from '#services/access_policy';
import User from '#models/user';
export default class AccessMiddleware {
    async handle(ctx, next) {
        const user = ctx.auth.user;
        if (!user)
            return next();
        const reason = await AccessPolicy.blockedReason(user);
        if (reason)
            return this.endSession(ctx, user, reason, '/login');
        if (!AccessPolicy.deviceAllowed(user, await AccessPolicy.knownDevice(ctx))) {
            return this.endSession(ctx, user, 'This PC is waiting for admin approval.', '/pending-approval');
        }
        return next();
    }
    async endSession(ctx, user, reason, to) {
        const tokenId = AccessPolicy.currentTokenId(ctx);
        if (tokenId !== null) {
            await User.accessTokens.delete(user, tokenId);
            return ctx.response.forbidden({ message: reason });
        }
        await ctx.auth.use('web').logout();
        ctx.session.regenerate();
        if (ctx.request.url().startsWith('/api/') || ctx.request.accepts(['html', 'json']) === 'json') {
            return ctx.response.forbidden({ message: reason });
        }
        ctx.session.flash('status', reason);
        return ctx.response.redirect(to);
    }
}
//# sourceMappingURL=access_middleware.js.map