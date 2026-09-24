import env from '#start/env';
export default class MaintenanceMiddleware {
    handle(ctx, next) {
        if (env.get('APP_MAINTENANCE_MODE') && ctx.request.url() !== '/up') {
            ctx.response.status(503);
            if (ctx.request.url().startsWith('/api/') || ctx.request.accepts(['html', 'json']) === 'json') {
                return ctx.response.send({ message: 'Down for maintenance' });
            }
            return ctx.response.send('Down for maintenance');
        }
        return next();
    }
}
//# sourceMappingURL=maintenance_middleware.js.map