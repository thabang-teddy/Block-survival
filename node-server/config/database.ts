import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/lucid'

/**
 * One SQLite file, like the Laravel app's default. `DB_DATABASE` moves it (relative
 * paths are from the app root); the default lives in tmp/.
 */
const filename = env.get('DB_DATABASE') ? app.makePath(env.get('DB_DATABASE')!) : app.tmpPath('db.sqlite3')

const dbConfig = defineConfig({
  connection: 'sqlite',
  connections: {
    sqlite: {
      client: 'better-sqlite3',
      connection: { filename },
      useNullAsDefault: true,
      // SQLite leaves foreign keys off per connection; the cascades (a deleted user takes
      // their scores, worlds and devices with them) depend on them
      pool: {
        afterCreate: (conn: { pragma(sql: string): unknown }, done: (err: Error | null, conn: unknown) => void) => {
          conn.pragma('foreign_keys = ON')
          done(null, conn)
        },
      },
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
    },
  },
})

export default dbConfig
