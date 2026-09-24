import { defineConfig } from '@adonisjs/shield';
const TOKENLESS = new Set(['/api/auth/token', '/api/auth/status']);
function skipsCsrf(ctx) {
    const url = ctx.request.url();
    if (TOKENLESS.has(url))
        return true;
    if (!url.startsWith('/api/'))
        return false;
    const bearer = /^Bearer\s+\S+/i.test(ctx.request.header('authorization') ?? '');
    return bearer && !ctx.session?.has('auth_web');
}
const shieldConfig = defineConfig({
    csp: {
        enabled: false,
        directives: {},
        reportOnly: false,
    },
    csrf: {
        enabled: true,
        exceptRoutes: skipsCsrf,
        enableXsrfCookie: true,
        methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    },
    xFrame: {
        enabled: true,
        action: 'DENY',
    },
    hsts: {
        enabled: true,
        maxAge: '180 days',
    },
    contentTypeSniffing: {
        enabled: true,
    },
});
export default shieldConfig;
//# sourceMappingURL=shield.js.map