import { describe, expect, test } from 'vitest'
import { BACKOFF_MS, HEALTHY_AFTER_MS, STOP_TIMEOUT_MS, Supervisor, UnknownWorldError, type FromWorker, type SupervisedWorld, type ToWorker, type WorkerHandle } from '../src/supervisor/Supervisor'
import type { Config } from '../src/config'

/** a worker that records what it was told and exits when the test says so */
class FakeWorker implements WorkerHandle {
  static nextPid = 100
  readonly pid = FakeWorker.nextPid++
  sent: ToWorker[] = []
  killed = false
  private message: (m: FromWorker) => void = () => {}
  private exit: (code: number | null) => void = () => {}
  /** answer a stop by exiting at once (a well-behaved worker) */
  constructor(private readonly exitOnStop = true) {}
  send(msg: ToWorker): void {
    this.sent.push(msg)
    if (msg.t === 'stop' && this.exitOnStop) queueMicrotask(() => this.exit(0))
  }
  kill(): void { this.killed = true; queueMicrotask(() => this.exit(null)) }
  onMessage(cb: (m: FromWorker) => void): void { this.message = cb }
  onExit(cb: (code: number | null) => void): void { this.exit = cb }
  report(m: FromWorker): void { this.message(m) }
  crash(code = 1): void { this.exit(code) }
}

const world = (id: string, autoStart = true): SupervisedWorld => ({ id, name: id.toUpperCase(), autoStart })
const config = (id: string): Config => ({ site: 'https://game.example', token: `${id}-${'t'.repeat(40)}`, relayOnly: false, logDir: `logs/${id}` })
const quiet = { info: () => {}, error: () => {} }

function setup(opts: { exitOnStop?: boolean; configFor?: (w: SupervisedWorld) => Promise<Config> } = {}) {
  let clock = 0
  const timers: { at: number; fn: () => void; id: number }[] = []
  let nextTimer = 1
  const workers: Record<string, FakeWorker[]> = {}
  const sup = new Supervisor({
    spawn: w => {
      const worker = new FakeWorker(opts.exitOnStop ?? true)
      ;(workers[w.id] ??= []).push(worker)
      return worker
    },
    configFor: opts.configFor ?? (async w => config(w.id)),
    log: quiet,
    now: () => clock,
    setTimer: (fn, ms) => { const id = nextTimer++; timers.push({ at: clock + ms, fn, id }); return id },
    clearTimer: h => { const i = timers.findIndex(t => t.id === h); if (i >= 0) timers.splice(i, 1) },
  })
  /** move the clock and fire what came due */
  const advance = async (ms: number) => {
    clock += ms
    for (const t of timers.filter(t => t.at <= clock)) {
      timers.splice(timers.indexOf(t), 1)
      t.fn()
    }
    await new Promise(r => setTimeout(r, 0))
  }
  const phase = (id: string) => sup.status().find(s => s.id === id)?.phase
  return { sup, workers, advance, phase, latest: (id: string) => workers[id].at(-1)! }
}

describe('Supervisor', () => {
  test('starts every auto-start world in its own process and hands each its own config', async () => {
    const { sup, workers, phase } = setup()
    await sup.load([world('home'), world('attic'), world('spare', false)])
    expect(Object.keys(workers).sort()).toEqual(['attic', 'home'])
    expect(workers.home[0].sent[0]).toEqual({ t: 'start', config: config('home') })
    expect(workers.attic[0].sent[0]).toEqual({ t: 'start', config: config('attic') })
    expect(phase('home')).toBe('starting')
    expect(phase('spare')).toBe('stopped')
  })

  test('status follows what each worker reports', async () => {
    const { sup, latest, phase } = setup()
    await sup.load([world('home')])
    latest('home').report({ t: 'status', phase: 'online', players: 3, code: 'PCPCPC', frozen: false })
    expect(sup.status()[0]).toMatchObject({ id: 'home', name: 'HOME', phase: 'online', players: 3, code: 'PCPCPC', pid: latest('home').pid })
    latest('home').report({ t: 'status', phase: 'online', players: 3, code: 'PCPCPC', frozen: true })
    expect(phase('home')).toBe('frozen')
  })

  test('stop asks the world to go offline and waits for it to exit', async () => {
    const { sup, latest, phase } = setup()
    await sup.load([world('home')])
    await sup.stop('home')
    expect(latest('home').sent.at(-1)).toEqual({ t: 'stop', going: 'offline' })
    expect(phase('home')).toBe('stopped')
    expect(sup.status()[0].pid).toBeNull()
  })

  test('restart pauses the players (`restart`) and runs a fresh process', async () => {
    const { sup, workers, phase } = setup()
    await sup.load([world('home')])
    await sup.restart('home')
    expect(workers.home).toHaveLength(2)
    expect(workers.home[0].sent.at(-1)).toEqual({ t: 'stop', going: 'restart' })
    expect(phase('home')).toBe('starting')
  })

  test('a crash in one world restarts only that world, after a growing delay', async () => {
    const { sup, workers, advance, phase, latest } = setup()
    await sup.load([world('home'), world('attic')])
    latest('home').crash(1)
    expect(phase('home')).toBe('crashed')
    expect(phase('attic')).toBe('starting')

    await advance(BACKOFF_MS[0] - 1)
    expect(workers.home).toHaveLength(1)
    await advance(1)
    expect(workers.home).toHaveLength(2)
    latest('home').crash(1)
    await advance(BACKOFF_MS[0])
    expect(workers.home).toHaveLength(2)
    await advance(BACKOFF_MS[1] - BACKOFF_MS[0])
    expect(workers.home).toHaveLength(3)
    expect(sup.status().find(s => s.id === 'home')!.restarts).toBe(2)
    expect(workers.attic).toHaveLength(1)
  })

  test('a world that ran for a while before crashing starts its count over', async () => {
    const { sup, advance, latest } = setup()
    await sup.load([world('home')])
    latest('home').crash(1)
    await advance(BACKOFF_MS[0])
    await advance(HEALTHY_AFTER_MS)
    latest('home').crash(1)
    expect(sup.status()[0].restarts).toBe(1)
  })

  test('stopping a crashed world cancels its restart', async () => {
    const { sup, workers, advance, phase, latest } = setup()
    await sup.load([world('home')])
    latest('home').crash(1)
    await sup.stop('home')
    await advance(BACKOFF_MS.at(-1)!)
    expect(workers.home).toHaveLength(1)
    expect(phase('home')).toBe('stopped')
  })

  test('a refused token is not restarted: the owner must paste a new one', async () => {
    const { sup, workers, advance, phase, latest } = setup()
    await sup.load([world('home')])
    latest('home').report({ t: 'revoked' })
    latest('home').crash(0)
    await advance(BACKOFF_MS.at(-1)!)
    expect(workers.home).toHaveLength(1)
    expect(phase('home')).toBe('revoked')
    expect(sup.status()[0].error).toMatch(/token/)
  })

  test('a world that does not stop in time is killed', async () => {
    const { sup, advance, latest, phase } = setup({ exitOnStop: false })
    await sup.load([world('home')])
    const stopping = sup.stop('home')
    expect(phase('home')).toBe('stopping')
    await advance(STOP_TIMEOUT_MS)
    await stopping
    expect(latest('home').killed).toBe(true)
    expect(phase('home')).toBe('stopped')
  })

  test('a token that cannot be read is an error, not a crash loop', async () => {
    const { sup, workers, phase } = setup({ configFor: async () => { throw new Error('saved on another PC') } })
    await sup.load([world('home')])
    expect(workers.home).toBeUndefined()
    expect(phase('home')).toBe('error')
    expect(sup.status()[0].error).toBe('saved on another PC')
  })

  test('reloading adds new worlds, takes removed ones offline and restarts changed ones', async () => {
    const { sup, workers, phase } = setup()
    await sup.load([world('home'), world('attic')])
    await sup.load([world('home'), world('shed')], new Set(['home']))
    expect(workers.attic[0].sent.at(-1)).toEqual({ t: 'stop', going: 'offline' })
    expect(sup.has('attic')).toBe(false)
    expect(workers.shed).toHaveLength(1)
    expect(workers.home).toHaveLength(2)
    expect(workers.home[0].sent.at(-1)).toEqual({ t: 'stop', going: 'restart' })
    expect(phase('home')).toBe('starting')
  })

  test('stopAll stops every world the same way', async () => {
    const { sup, workers } = setup()
    await sup.load([world('home'), world('attic')])
    await sup.stopAll('restart')
    expect(workers.home[0].sent.at(-1)).toEqual({ t: 'stop', going: 'restart' })
    expect(workers.attic[0].sent.at(-1)).toEqual({ t: 'stop', going: 'restart' })
    expect(sup.status().every(s => s.phase === 'stopped')).toBe(true)
  })

  test('an unknown world is refused', async () => {
    const { sup } = setup()
    await expect(sup.start('nope')).rejects.toBeInstanceOf(UnknownWorldError)
  })
})
