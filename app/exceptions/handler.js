import app from '@adonisjs/core/services/app';
import { ExceptionHandler } from '@adonisjs/core/http';
import { errors as vineErrors } from '@vinejs/vine';
import { errors as authErrors } from '@adonisjs/auth';
import { errors as limiterErrors } from '@adonisjs/limiter';
function groupMessages(messages) {
    const out = {};
    for (const m of messages)
        (out[m.field] ??= []).push(m.message);
    return out;
}
export default class HttpExceptionHandler extends ExceptionHandler {
    debug = !app.inProduction;
    renderStatusPages = false;
    statusPages = {};
    async handle(error, ctx) {
        if (!ctx.request.url().startsWith('/api/'))
            return super.handle(error, ctx);
        if (error instanceof vineErrors.E_VALIDATION_ERROR) {
            const messages = error.messages;
            return ctx.response.status(422).send({ message: messages[0]?.message ?? 'Invalid data.', errors: groupMessages(messages) });
        }
        if (error instanceof authErrors.E_UNAUTHORIZED_ACCESS) {
            return ctx.response.status(401).send({ message: 'Unauthenticated.' });
        }
        if (error instanceof limiterErrors.E_TOO_MANY_REQUESTS) {
            return ctx.response.status(429).send({ message: 'Too Many Attempts.' });
        }
        const status = error.status ?? 500;
        if (status >= 500) {
            await this.report(error, ctx);
            return ctx.response.status(500).send({ message: app.inProduction ? 'Server Error' : String(error.message) });
        }
        const message = status === 404 ? 'Not Found' : error.message;
        return ctx.response.status(status).send({ message });
    }
    async report(error, ctx) {
        return super.report(error, ctx);
    }
}
//# sourceMappingURL=handler.js.map