/**
 * Rate limits, matching the Laravel app's `throttle:<n>,1` middleware: signed-in callers
 * are counted by account, everyone else by IP.
 */
import limiter from '@adonisjs/limiter/services/main'
import type { HttpContext } from '@adonisjs/core/http'

const callerKey = (ctx: HttpContext): string => (ctx.auth?.user ? `user_${ctx.auth.user.id}` : `ip_${ctx.request.ip()}`)

/** `n` requests a minute per caller, under `name` so separate limits never share a counter */
function perMinute(name: string, n: number) {
  return limiter.define(name, (ctx) => limiter.allowRequests(n).every('1 minute').usingKey(`${name}_${callerKey(ctx)}`))
}

/** sign-in and the dev guest button: brute-force protection */
export const throttleLogin = perMinute('login', 10)
/** the parked browser / native client asking whether it has been approved yet */
export const throttlePoll = perMinute('poll', 30)
/** the JSON endpoints the running game uses */
export const throttleApi = perMinute('api', 60)
/**
 * WebRTC signalling (native clients hosting peer-to-peer) is polled at up to 2 Hz per
 * peer: a host and a joiner behind one NAT is ~240 requests a minute plus a handshake.
 */
export const throttleSignal = limiter.define('signal', (ctx) =>
  limiter.allowRequests(600).every('1 minute').usingKey(`signal_ip_${ctx.request.ip()}`)
)
