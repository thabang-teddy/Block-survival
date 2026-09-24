import { defineConfig } from '@adonisjs/shield'
import type { HttpContext } from '@adonisjs/core/http'

/** sign-in and the approval poll have no token yet; neither opens a session */
const TOKENLESS = new Set(['/api/auth/token', '/api/auth/status'])

/**
 * CSRF protects cookie-carried sessions. The native client talks to /api with a bearer
 * token and no session, so it has no CSRF token to send — and a request that carries a
 * bearer token and no signed-in session cannot be forged by another origin (a browser
 * will not attach a custom Authorization header cross-origin without a CORS preflight,
 * which the API does not grant). Anything with a session behind it is still checked.
 */
function skipsCsrf(ctx: HttpContext): boolean {
  const url = ctx.request.url()
  if (TOKENLESS.has(url)) return true
  if (!url.startsWith('/api/')) return false
  const bearer = /^Bearer\s+\S+/i.test(ctx.request.header('authorization') ?? '')
  return bearer && !ctx.session?.has('auth_web')
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
    // Inertia and the game's fetch calls send it back as X-XSRF-TOKEN
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
})

export default shieldConfig
