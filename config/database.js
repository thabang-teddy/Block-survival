import env from '#start/env';
import app from '@adonisjs/core/services/app';
import { defineConfig } from '@adonisjs/lucid';
const filename = env.get('DB_DATABASE') ? app.makePath(env.get('DB_DATABASE')) : app.tmpPath('db.sqlite3');
const dbConfig = defineConfig({
    connection: 'sqlite',
    connections: {
        sqlite: {
            client: 'better-sqlite3',
            connection: { filename },
            useNullAsDefault: true,
            pool: {
                afterCreate: (conn, done) => {
                    conn.pragma('foreign_keys = ON');
                    done(null, conn);
                },
            },
            migrations: {
                naturalSort: true,
                paths: ['database/migrations'],
            },
        },
    },
});
export default dbConfig;
//# sourceMappingURL=database.js.map