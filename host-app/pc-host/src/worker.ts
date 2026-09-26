/**
 * `pc-host worker`: one world, run for the supervisor (docs/pc-host-research.md §8). It
 * waits for its config over IPC, runs the world, reports its status every few seconds,
 * and stops when asked — saving first. If the supervisor goes away, the world stops
 * with `restart`, so its players stay paused until the service is back.
 */
import type { Config } from './config'
import type { FromWorker, ToWorker } from './supervisor/Supervisor'
import { runWorld, type RunningWorld } from './runWorld'

const STATUS_MS = 3000

export function runWorker(version: string, appDir: string): void {
  let world: RunningWorld | null = null
  let exiting = false
  const report = (msg: FromWorker) => { if (process.connected) process.send?.(msg) }

  async function exit(going: 'offline' | 'restart', code: number): Promise<void> {
    if (exiting) return
    exiting = true
    clearInterval(timer)
    await world?.stop(going)
    report({ t: 'status', phase: 'stopped', players: 0, code: null, frozen: false })
    process.exit(code)
  }

  function start(config: Config): void {
    if (world) return
    world = runWorld(config, {
      version,
      appDir,
      echo: false,
      onRevoked: () => { report({ t: 'revoked' }); void exit('restart', 0) },
      // the host app shows it on the world's card
      onProblem: problem => report({ t: 'error', message: problem ?? '' }),
    })
    process.on('uncaughtException', err => {
      world?.log.error('crashed', { err: err.stack ?? String(err) })
      report({ t: 'error', message: `The world crashed: ${err.message}` })
      // a non-zero exit: the supervisor starts it again, which loads the last save
      void exit('restart', 1)
    })
  }

  const timer = setInterval(() => {
    const host = world?.host
    if (!host) return
    report({
      t: 'status',
      phase: host.phase === 'online' ? 'online' : host.phase === 'stopped' ? 'stopped' : 'starting',
      players: host.room?.playerCount ?? 0,
      code: host.room ? host.roomCode : null,
      frozen: host.room?.isFrozen ?? false,
    })
  }, STATUS_MS)

  process.on('message', (msg: ToWorker) => {
    if (msg?.t === 'start') start(msg.config)
    else if (msg?.t === 'stop') void exit(msg.going, 0)
  })
  // the supervisor is gone (killed, or the service stopped under it)
  process.on('disconnect', () => { void exit('restart', 0) })
  // Ctrl+C reaches the whole console group when WinSW stops the service: the supervisor asks the same
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) process.on(sig, () => { void exit('restart', 0) })
}
