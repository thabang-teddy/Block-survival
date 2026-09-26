/**
 * When the host uploads the world (issue #13): every AUTOSAVE_SECONDS of play if
 * anything changed, never two uploads at once, and a manual / dawn save that runs now
 * and restarts the clock. A failed upload is retried after a short pause.
 */
export const AUTOSAVE_SECONDS = 60
export const RETRY_SECONDS = 15

interface Deferred {
  promise: Promise<void>
  resolve: () => void
  reject: (err: unknown) => void
}

function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (err: unknown) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

export class Autosave {
  private readonly upload: () => Promise<void>
  private readonly interval: number
  private elapsed = 0
  private dirty = false
  private current: Promise<void> | null = null
  /** a saveNow that arrived while an upload was running: one more upload after it */
  private queued: Deferred | null = null
  /** uploads finished / failed since construction (for the HUD and tests) */
  saved = 0
  failed = 0

  constructor(upload: () => Promise<void>, interval = AUTOSAVE_SECONDS) {
    this.upload = upload
    this.interval = interval
  }

  /** something worth saving happened */
  markDirty(): void {
    this.dirty = true
  }

  get isDirty(): boolean {
    return this.dirty
  }

  get inFlight(): boolean {
    return this.current !== null
  }

  /** advance the clock; returns true when an autosave was started */
  tick(dt: number): boolean {
    this.elapsed += dt
    if (!this.dirty || this.current || this.elapsed < this.interval) return false
    this.start().catch(() => {})
    return true
  }

  /** save now (manual, dawn, quit); if one is running, run another after it */
  saveNow(): Promise<void> {
    if (!this.current) return this.start()
    this.queued ??= deferred()
    return this.queued.promise
  }

  private start(): Promise<void> {
    this.dirty = false
    this.elapsed = 0
    const run = this.upload().then(
      () => { this.saved++ },
      (err: unknown) => {
        // keep what we have as dirty and try again soon
        this.failed++
        this.dirty = true
        this.elapsed = this.interval - RETRY_SECONDS
        throw err
      },
    )
    this.current = run.then(() => {}, () => {}).then(() => {
      this.current = null
      const next = this.queued
      if (!next) return
      this.queued = null
      this.start().then(next.resolve, next.reject)
    })
    return run
  }
}
