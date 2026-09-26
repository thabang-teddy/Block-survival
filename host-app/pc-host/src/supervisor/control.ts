/**
 * The control API the Block Survival Host app talks to: HTTP on 127.0.0.1 only, behind
 * a random key the service writes to its data folder (readable by the admins who set the
 * host up, not by other users). It never exposes a token.
 *
 *   GET  /status                   every world's phase, players and last error
 *   POST /worlds/:id/start|stop|restart
 *   POST /stop-all                 every world goes offline
 *   POST /reload                   re-read config.json (worlds added, removed or changed); 422 if it is broken
 *   GET  /worlds/:id/log?lines=N   the tail of that world's log
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { UnknownWorldError, type Supervisor, type WorldStatus } from './Supervisor'

export interface ControlDeps {
  supervisor: Pick<Supervisor, 'status' | 'start' | 'stop' | 'restart' | 'stopAll' | 'has'>
  key: string
  version: string
  reload(): Promise<void>
  /** what is wrong with config.json, if anything */
  problem(): string | null
  logTail(id: string, lines: number): string[]
  log: { error(msg: string, data?: Record<string, unknown>): void }
}

const MAX_LOG_LINES = 1000
const LOCAL_HOSTS = /^(127\.0\.0\.1|localhost)(:\d+)?$/i

export function authorized(header: string | undefined, key: string): boolean {
  const given = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '')
  const want = Buffer.from(key)
  return given.length === want.length && timingSafeEqual(given, want)
}

export async function handle(req: IncomingMessage, res: ServerResponse, deps: ControlDeps): Promise<void> {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  // a web page cannot reach us by pointing a DNS name at 127.0.0.1
  if (!LOCAL_HOSTS.test(req.headers.host ?? '')) return send(403, { message: 'Local requests only.' })
  if (!authorized(req.headers.authorization, deps.key)) return send(401, { message: 'Missing or wrong control key.' })
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const method = req.method ?? 'GET'
  try {
    if (method === 'GET' && path === '/status') {
      return send(200, { version: deps.version, problem: deps.problem(), worlds: deps.supervisor.status() satisfies WorldStatus[] })
    }
    if (method === 'POST' && path === '/stop-all') {
      await deps.supervisor.stopAll('offline')
      return send(200, { worlds: deps.supervisor.status() })
    }
    if (method === 'POST' && path === '/reload') {
      try {
        await deps.reload()
      } catch (err) {
        return send(422, { message: err instanceof Error ? err.message : String(err) })
      }
      return send(200, { worlds: deps.supervisor.status() })
    }
    const m = /^\/worlds\/([A-Za-z0-9-]{1,32})\/(start|stop|restart|log)$/.exec(path)
    if (m) {
      const [, id, action] = m
      if (!deps.supervisor.has(id)) return send(404, { message: `No world "${id}" on this PC.` })
      if (action === 'log' && method === 'GET') {
        const lines = Math.min(MAX_LOG_LINES, Math.max(1, Number(url.searchParams.get('lines')) || 200))
        return send(200, { lines: deps.logTail(id, lines) })
      }
      if (method !== 'POST') return send(405, { message: 'Use POST.' })
      // stop and restart wait for the world to save; start returns once it is launching
      if (action === 'start') await deps.supervisor.start(id)
      else if (action === 'stop') await deps.supervisor.stop(id, 'offline')
      else await deps.supervisor.restart(id)
      return send(200, { worlds: deps.supervisor.status() })
    }
    return send(404, { message: 'No such route.' })
  } catch (err) {
    if (err instanceof UnknownWorldError) return send(404, { message: err.message })
    deps.log.error('control request failed', { path, err: String(err) })
    return send(500, { message: err instanceof Error ? err.message : String(err) })
  }
}

export function startControl(port: number, deps: ControlDeps): Promise<Server> {
  const server = createServer((req, res) => { void handle(req, res, deps) })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}
