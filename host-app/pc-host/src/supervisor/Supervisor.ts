/**
 * Runs several global worlds on one PC (docs/pc-host-research.md §8): one worker process
 * per world, so a world that crashes — or a native WebRTC fault in it — never takes the
 * others down. The supervisor starts and stops them, restarts a crashed one with a
 * growing delay, and keeps what the control API reports: each world's phase, players
 * and last word.
 *
 * Talking to a worker is IPC: `start` hands it its config (the token never touches the
 * disk in the clear), `stop` asks it to save and tell the site `offline` (the world
 * closes) or `restart` (players stay paused). It reports `status` and `revoked`.
 */
import type { Config } from '../config'

export type WorldPhase = 'stopped' | 'starting' | 'online' | 'frozen' | 'stopping' | 'crashed' | 'revoked' | 'error'
export type Going = 'offline' | 'restart'

export type ToWorker = { t: 'start'; config: Config } | { t: 'stop'; going: Going }
export type FromWorker =
  | { t: 'status'; phase: 'starting' | 'online' | 'stopped'; players: number; code: string | null; frozen: boolean }
  | { t: 'revoked' }
  | { t: 'error'; message: string }

/** a worker process as the supervisor sees it (a fake in tests) */
export interface WorkerHandle {
  readonly pid: number | undefined
  send(msg: ToWorker): void
  kill(): void
  onMessage(cb: (msg: FromWorker) => void): void
  onExit(cb: (code: number | null) => void): void
}

export interface SupervisedWorld {
  id: string
  name: string
  autoStart: boolean
}

export interface WorldStatus {
  id: string
  name: string
  phase: WorldPhase
  players: number
  code: string | null
  pid: number | null
  /** crashes since it last ran for a while */
  restarts: number
  /** when the worker last reported (ms since epoch) */
  lastReportAt: number | null
  error: string | null
}

export interface SupervisorOptions {
  spawn(world: SupervisedWorld): WorkerHandle
  /** the world's config, token included; may read a DPAPI-protected token */
  configFor(world: SupervisedWorld): Promise<Config>
  log: { info(msg: string, data?: Record<string, unknown>): void; error(msg: string, data?: Record<string, unknown>): void }
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

/** waits before starting a crashed world again: 5 s, 15 s, 30 s, 1 min, then every 2 min */
export const BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000]
/** a world that ran this long is healthy again: its crash count starts over */
export const HEALTHY_AFTER_MS = 10 * 60_000
/** how long a worker gets to save and say goodbye before it is killed */
export const STOP_TIMEOUT_MS = 40_000

interface Slot {
  world: SupervisedWorld
  worker: WorkerHandle | null
  phase: WorldPhase
  players: number
  code: string | null
  restarts: number
  startedAt: number
  lastReportAt: number | null
  error: string | null
  /** the owner wants it running: a crash is restarted */
  wanted: boolean
  /** start it again once the current worker has exited */
  thenStart: boolean
  retryTimer: unknown
  killTimer: unknown
  exited: Promise<void> | null
}

export class Supervisor {
  private readonly slots = new Map<string, Slot>()
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(private readonly opts: SupervisorOptions) {
    this.now = opts.now ?? Date.now
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = opts.clearTimer ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  /**
   * Take a (new) list of worlds: new ones that auto-start are started, removed ones are
   * stopped (offline), and ones whose settings changed are restarted if running.
   */
  async load(worlds: SupervisedWorld[], changed: ReadonlySet<string> = new Set()): Promise<void> {
    const keep = new Set(worlds.map(w => w.id))
    const removals = [...this.slots.values()].filter(s => !keep.has(s.world.id))
    await Promise.all(removals.map(async s => {
      await this.stop(s.world.id, 'offline')
      this.slots.delete(s.world.id)
    }))
    for (const world of worlds) {
      const slot = this.slots.get(world.id)
      if (!slot) {
        this.slots.set(world.id, this.newSlot(world))
        if (world.autoStart) await this.start(world.id)
      } else {
        slot.world = world
        if (changed.has(world.id) && slot.worker) await this.restart(world.id)
      }
    }
  }

  status(): WorldStatus[] {
    return [...this.slots.values()].map(s => ({
      id: s.world.id,
      name: s.world.name,
      phase: s.phase,
      players: s.players,
      code: s.code,
      pid: s.worker?.pid ?? null,
      restarts: s.restarts,
      lastReportAt: s.lastReportAt,
      error: s.error,
    }))
  }

  has(id: string): boolean {
    return this.slots.has(id)
  }

  async start(id: string): Promise<void> {
    const slot = this.slot(id)
    slot.wanted = true
    if (slot.retryTimer !== null) { this.clearTimer(slot.retryTimer); slot.retryTimer = null }
    if (slot.worker) {
      // already running, or on its way out: start again once it has gone
      if (slot.phase === 'stopping') slot.thenStart = true
      return
    }
    await this.launch(slot)
  }

  /** save, tell the site, and end the worker; resolves once it has exited */
  async stop(id: string, going: Going = 'offline'): Promise<void> {
    const slot = this.slot(id)
    slot.wanted = false
    slot.thenStart = false
    if (slot.retryTimer !== null) { this.clearTimer(slot.retryTimer); slot.retryTimer = null }
    if (!slot.worker) {
      if (slot.phase === 'crashed') slot.phase = 'stopped'
      return
    }
    if (slot.phase !== 'stopping') {
      slot.phase = 'stopping'
      slot.worker.send({ t: 'stop', going })
      const worker = slot.worker
      slot.killTimer = this.setTimer(() => {
        this.opts.log.error('a world did not stop in time; killing it', { world: id })
        worker.kill()
      }, STOP_TIMEOUT_MS)
    }
    await slot.exited
  }

  /** stop with `restart` (players stay paused) and start again */
  async restart(id: string): Promise<void> {
    const slot = this.slot(id)
    if (slot.worker) {
      await this.stop(id, 'restart')
    }
    await this.start(id)
  }

  /** every world, e.g. when the service stops (`restart`) or the owner stops hosting (`offline`) */
  async stopAll(going: Going): Promise<void> {
    await Promise.all([...this.slots.keys()].map(id => this.stop(id, going)))
  }

  private newSlot(world: SupervisedWorld): Slot {
    return {
      world, worker: null, phase: 'stopped', players: 0, code: null, restarts: 0, startedAt: 0,
      lastReportAt: null, error: null, wanted: false, thenStart: false, retryTimer: null, killTimer: null, exited: null,
    }
  }

  private slot(id: string): Slot {
    const slot = this.slots.get(id)
    if (!slot) throw new UnknownWorldError(id)
    return slot
  }

  private async launch(slot: Slot): Promise<void> {
    let config: Config
    try {
      config = await this.opts.configFor(slot.world)
    } catch (err) {
      slot.phase = 'error'
      slot.error = err instanceof Error ? err.message : String(err)
      slot.wanted = false
      this.opts.log.error('could not start a world', { world: slot.world.id, err: slot.error })
      return
    }
    // stopped or started again while the token was being read
    if (!slot.wanted || slot.worker) return
    const worker = this.opts.spawn(slot.world)
    slot.worker = worker
    slot.phase = 'starting'
    slot.error = null
    slot.players = 0
    slot.code = null
    slot.startedAt = this.now()
    let resolveExit!: () => void
    slot.exited = new Promise(r => { resolveExit = r })
    worker.onMessage(msg => this.onMessage(slot, worker, msg))
    worker.onExit(code => { this.onExit(slot, worker, code); resolveExit() })
    worker.send({ t: 'start', config })
    this.opts.log.info('world started', { world: slot.world.id, pid: worker.pid })
  }

  private onMessage(slot: Slot, worker: WorkerHandle, msg: FromWorker): void {
    if (slot.worker !== worker) return
    slot.lastReportAt = this.now()
    if (msg.t === 'status') {
      slot.players = msg.players
      slot.code = msg.code
      if (slot.phase !== 'stopping') slot.phase = msg.phase === 'online' ? (msg.frozen ? 'frozen' : 'online') : msg.phase === 'stopped' ? 'stopping' : 'starting'
    } else if (msg.t === 'revoked') {
      slot.wanted = false
      slot.phase = 'revoked'
      slot.error = 'The site refused this host token: it was rotated or removed. Paste the new one.'
    } else if (msg.t === 'error') {
      slot.error = msg.message
    }
  }

  private onExit(slot: Slot, worker: WorkerHandle, code: number | null): void {
    if (slot.worker !== worker) return
    if (slot.killTimer !== null) { this.clearTimer(slot.killTimer); slot.killTimer = null }
    slot.worker = null
    slot.players = 0
    slot.code = null
    if (slot.phase === 'revoked') {
      this.opts.log.error('a world stopped: its token was refused', { world: slot.world.id })
      return
    }
    const wasStopping = slot.phase === 'stopping'
    if (wasStopping || !slot.wanted) {
      slot.phase = 'stopped'
      this.opts.log.info('world stopped', { world: slot.world.id, code })
      if (slot.thenStart) {
        slot.thenStart = false
        slot.wanted = true
        void this.launch(slot)
      }
      return
    }
    // it went away by itself: a crash (or a clean exit nobody asked for)
    if (this.now() - slot.startedAt >= HEALTHY_AFTER_MS) slot.restarts = 0
    const wait = BACKOFF_MS[Math.min(slot.restarts, BACKOFF_MS.length - 1)]
    slot.restarts++
    slot.phase = 'crashed'
    slot.error = slot.error ?? `The world's process exited (code ${code ?? 'none'}).`
    this.opts.log.error('a world crashed; starting it again', { world: slot.world.id, code, in_ms: wait, restarts: slot.restarts })
    slot.retryTimer = this.setTimer(() => {
      slot.retryTimer = null
      if (slot.wanted && !slot.worker) void this.launch(slot)
    }, wait)
  }
}

export class UnknownWorldError extends Error {
  constructor(readonly id: string) {
    super(`No world "${id}" on this PC.`)
  }
}
