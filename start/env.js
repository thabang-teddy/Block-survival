import { Env } from '@adonisjs/core/env';
export default await Env.create(new URL('../', import.meta.url), {
    NODE_ENV: Env.schema.enum(['development', 'production', 'test']),
    PORT: Env.schema.number(),
    HOST: Env.schema.string({ format: 'host' }),
    LOG_LEVEL: Env.schema.string(),
    APP_KEY: Env.schema.secret(),
    APP_URL: Env.schema.string({ format: 'url', tld: false }),
    APP_MAINTENANCE_MODE: Env.schema.boolean.optional(),
    APP_TIMEZONE: Env.schema.string.optional(),
    SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database']),
    DB_DATABASE: Env.schema.string.optional(),
    ADMIN_EMAIL: Env.schema.string.optional(),
    ADMIN_PASSWORD: Env.schema.string.optional(),
    ADMIN_NAME: Env.schema.string.optional(),
    GUEST_LOGIN: Env.schema.boolean.optional(),
});
//# sourceMappingURL=env.js.map