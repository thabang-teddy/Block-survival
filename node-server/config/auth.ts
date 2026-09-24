import { defineConfig } from '@adonisjs/auth'
import { tokensGuard, tokensUserProvider } from '@adonisjs/auth/access_tokens'
import { sessionGuard, sessionUserProvider } from '@adonisjs/auth/session'
import type { InferAuthenticators, InferAuthEvents, Authenticators } from '@adonisjs/auth/types'

/**
 * `web`: the browser's session (pages and the game's /api calls). `api`: the native
 * client's bearer token (docs/flutter-client-plan.md D2 / S5). The JSON API accepts
 * either, as Laravel's `auth:sanctum` did.
 */
const authConfig = defineConfig({
  default: 'web',
  guards: {
    web: sessionGuard({
      // the session cookie itself lives for 30 days (config/session.ts): a signed-in
      // browser stays signed in, as with Laravel's "remember me"
      useRememberMeTokens: false,
      provider: sessionUserProvider({
        model: () => import('#models/user'),
      }),
    }),
    api: tokensGuard({
      provider: tokensUserProvider({
        tokens: 'accessTokens',
        model: () => import('#models/user'),
      }),
    }),
  },
})

export default authConfig

/**
 * Inferring types from the configured auth
 * guards.
 */
declare module '@adonisjs/auth/types' {
  export interface Authenticators extends InferAuthenticators<typeof authConfig> {}
}
declare module '@adonisjs/core/types' {
  interface EventsList extends InferAuthEvents<Authenticators> {}
}
