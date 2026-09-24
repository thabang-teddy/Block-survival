/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),
  /** takes the site down (503) without a redeploy; /up keeps answering */
  APP_MAINTENANCE_MODE: Env.schema.boolean.optional(),
  /** the zone the login window falls back to when an admin has not picked one */
  APP_TIMEZONE: Env.schema.string.optional(),

  // Session
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),

  // Database: the SQLite file (default tmp/db.sqlite3)
  DB_DATABASE: Env.schema.string.optional(),

  // Admin account (`node ace admin:sync`); ADMIN_EMAIL is always an admin
  ADMIN_EMAIL: Env.schema.string.optional(),
  ADMIN_PASSWORD: Env.schema.string.optional(),
  ADMIN_NAME: Env.schema.string.optional(),
  /** the sign-in page's one-click guest account (defaults to on in development only) */
  GUEST_LOGIN: Env.schema.boolean.optional(),
})
