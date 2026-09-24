import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import type { StatusPageRange, StatusPageRenderer } from '@adonisjs/core/types/http'
import { errors as vineErrors } from '@vinejs/vine'
import { errors as authErrors } from '@adonisjs/auth'
import { errors as limiterErrors } from '@adonisjs/limiter'

/** Vine's per-field messages, grouped the way Laravel's 422 body groups them */
function groupMessages(messages: { field: string; message: string }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const m of messages) (out[m.field] ??= []).push(m.message)
  return out
}

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = !app.inProduction

  /**
   * Status pages are used to display a custom HTML pages for certain error
   * codes. You might want to enable them in production only, but feel
   * free to enable them in development as well.
   */
  protected renderStatusPages = false

  protected statusPages: Record<StatusPageRange, StatusPageRenderer> = {}

  /**
   * The JSON API (/api/*) answers in the Laravel app's shapes, which both clients parse:
   * `{ message }`, plus `errors: { field: [messages] }` on a 422. Pages and forms keep
   * AdonisJS's own handling (validation errors flash back to the form).
   */
  async handle(error: unknown, ctx: HttpContext) {
    if (!ctx.request.url().startsWith('/api/')) return super.handle(error, ctx)

    if (error instanceof vineErrors.E_VALIDATION_ERROR) {
      const messages = error.messages as { field: string; message: string }[]
      return ctx.response.status(422).send({ message: messages[0]?.message ?? 'Invalid data.', errors: groupMessages(messages) })
    }
    if (error instanceof authErrors.E_UNAUTHORIZED_ACCESS) {
      return ctx.response.status(401).send({ message: 'Unauthenticated.' })
    }
    if (error instanceof limiterErrors.E_TOO_MANY_REQUESTS) {
      return ctx.response.status(429).send({ message: 'Too Many Attempts.' })
    }
    const status = (error as { status?: number }).status ?? 500
    if (status >= 500) {
      await this.report(error, ctx)
      return ctx.response.status(500).send({ message: app.inProduction ? 'Server Error' : String((error as Error).message) })
    }
    const message = status === 404 ? 'Not Found' : (error as Error).message
    return ctx.response.status(status).send({ message })
  }

  /**
   * The method is used to report error to the logging service or
   * the a third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}
