import { afterEach, describe, expect, test, vi } from 'vitest'
import { request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { authorized, startControl, type ControlDeps } from '../src/supervisor/control'
import type { WorldStatus } from '../src/supervisor/Supervisor'

const KEY = 'k'.repeat(64)
const status: WorldStatus[] = [{ id: 'home', name: 'Home', phase: 'online', players: 2, code: 'PCPCPC', pid: 42, restarts: 0, lastReportAt: 1, error: null }]

function deps(over: Partial<ControlDeps> = {}): ControlDeps {
  return {
    supervisor: {
      status: vi.fn(() => status),
      has: vi.fn((id: string) => id === 'home'),
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      stopAll: vi.fn(async () => {}),
    },
    key: KEY,
    version: '0.2.0',
    reload: vi.fn(async () => {}),
    problem: () => null,
    logTail: vi.fn(() => ['{"msg":"hi"}']),
    log: { error: () => {} },
    ...over,
  }
}

describe('the control API', () => {
  let server: Server | null = null
  afterEach(() => { server?.close(); server = null })

  async function serve(d: ControlDeps) {
    server = await startControl(0, d)
    const port = (server.address() as AddressInfo).port
    return (method: string, path: string, key: string | null = KEY) => fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    })
  }

  test('only the key opens it', async () => {
    const call = await serve(deps())
    expect((await call('GET', '/status', null)).status).toBe(401)
    expect((await call('GET', '/status', 'wrong')).status).toBe(401)
    expect(authorized(`Bearer ${KEY}`, KEY)).toBe(true)
    expect(authorized(KEY, KEY)).toBe(false)
  })

  test('reports every world and never a token', async () => {
    const call = await serve(deps({ problem: () => 'worlds[0] needs its host token' }))
    const res = await call('GET', '/status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ version: '0.2.0', problem: 'worlds[0] needs its host token', worlds: status })
    expect(JSON.stringify(body)).not.toMatch(/token":/)
  })

  test('starts, stops (offline) and restarts one world', async () => {
    const d = deps()
    const call = await serve(d)
    expect((await call('POST', '/worlds/home/start')).status).toBe(200)
    expect((await call('POST', '/worlds/home/stop')).status).toBe(200)
    expect((await call('POST', '/worlds/home/restart')).status).toBe(200)
    expect(d.supervisor.start).toHaveBeenCalledWith('home')
    expect(d.supervisor.stop).toHaveBeenCalledWith('home', 'offline')
    expect(d.supervisor.restart).toHaveBeenCalledWith('home')
    expect((await call('POST', '/worlds/nope/start')).status).toBe(404)
    expect((await call('GET', '/worlds/home/start')).status).toBe(405)
  })

  test('stops everything, reloads, and tails a log', async () => {
    const d = deps()
    const call = await serve(d)
    expect((await call('POST', '/stop-all')).status).toBe(200)
    expect(d.supervisor.stopAll).toHaveBeenCalledWith('offline')
    expect((await call('POST', '/reload')).status).toBe(200)
    expect(d.reload).toHaveBeenCalledOnce()
    const log = await call('GET', '/worlds/home/log?lines=5000')
    expect(await log.json()).toEqual({ lines: ['{"msg":"hi"}'] })
    expect(d.logTail).toHaveBeenCalledWith('home', 1000)
  })

  test('a broken config is a 422 with what is wrong', async () => {
    const call = await serve(deps({ reload: async () => { throw new Error('"worlds" must be a list') } }))
    const res = await call('POST', '/reload')
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ message: '"worlds" must be a list' })
  })

  test('refuses requests addressed to another host name (DNS rebinding)', async () => {
    await serve(deps())
    const port = (server!.address() as AddressInfo).port
    // fetch will not send a Host header of our choosing; plain http will
    const status = await new Promise<number>((resolve, reject) => {
      request({ host: '127.0.0.1', port, path: '/status', headers: { Host: 'evil.example', Authorization: `Bearer ${KEY}` } }, res => {
        res.resume()
        resolve(res.statusCode ?? 0)
      }).on('error', reject).end()
    })
    expect(status).toBe(403)
  })
})
