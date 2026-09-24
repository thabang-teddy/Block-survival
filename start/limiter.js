import limiter from '@adonisjs/limiter/services/main';
const callerKey = (ctx) => (ctx.auth?.user ? `user_${ctx.auth.user.id}` : `ip_${ctx.request.ip()}`);
function perMinute(name, n) {
    return limiter.define(name, (ctx) => limiter.allowRequests(n).every('1 minute').usingKey(`${name}_${callerKey(ctx)}`));
}
export const throttleLogin = perMinute('login', 10);
export const throttlePoll = perMinute('poll', 30);
export const throttleApi = perMinute('api', 60);
export const throttleSignal = limiter.define('signal', (ctx) => limiter.allowRequests(600).every('1 minute').usingKey(`signal_ip_${ctx.request.ip()}`));
//# sourceMappingURL=limiter.js.map