import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import env from '#start/env'

/**
 * Takes the site down when APP_MAINTENANCE_MODE=true, without a redeploy. The /up health
 * endpoint stays reachable so uptime probes can tell "maintenance" from "dead".
 */
export default class MaintenanceMiddleware {
  handle(ctx: HttpContext, next: NextFn) {
    if (env.get('APP_MAINTENANCE_MODE') && ctx.request.url() !== '/up') {
      ctx.response.status(503)
      if (ctx.request.url().startsWith('/api/') || ctx.request.accepts(['html', 'json']) === 'json') {
        return ctx.response.send({ message: 'Down for maintenance' })
      }
      return ctx.response.send('Down for maintenance')
    }
    return next()
  }
}
