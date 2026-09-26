/**
 * pc-host — hosts Block Survival global worlds on this PC (docs/pc-host-research.md).
 *
 *   node dist/pc-host.mjs service    the Windows service: one worker per world in
 *                                    config.json, and the control API the Block
 *                                    Survival Host app talks to (§8)
 *   node dist/pc-host.mjs run        one world from a single-world config.json, in a window
 *   node dist/pc-host.mjs offline    close a `run` world: save, tell the site, stop
 *   node dist/pc-host.mjs worker     one world for the service (started by it, over IPC)
 *
 * Stopping `run` any other way (Ctrl+C, Windows stopping a single-world service) saves
 * the world and keeps the players paused until the PC is back.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, ConfigError, type Config } from './config'
import { makePeerId } from './PcHost'
import { HttpSite } from './site'
import { runWorld } from './runWorld'
import { runWorker } from './worker'
import { runService } from './supervisor/service'

declare const __PC_HOST_VERSION__: string
const VERSION = typeof __PC_HOST_VERSION__ === 'string' ? __PC_HOST_VERSION__ : '0.0.0-dev'

/** the folder holding the app (and, for `run`, config.json, logs and the pid file): dist/.. */
const APP_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PID_FILE = join(APP_DIR, 'pc-host.pid')
const OFFLINE_FLAG = join(APP_DIR, 'offline.request')
const OFFLINE_WAIT_MS = 60_000

function config(): Config {
  try {
    return loadConfig(process.env.PC_HOST_CONFIG ?? join(APP_DIR, 'config.json'))
  } catch (err) {
    process.stderr.write(`${err instanceof ConfigError ? err.message : String(err)}\n`)
    process.exit(2)
  }
}

function run(): void {
  const world = runWorld(config(), {
    version: VERSION,
    appDir: APP_DIR,
    echo: true,
    onRevoked: () => { void exit('restart', 0) },
  })
  let exiting = false

  async function exit(going: 'offline' | 'restart', code: number): Promise<void> {
    if (exiting) return
    exiting = true
    clearInterval(flagTimer)
    await world.stop(going)
    rmSync(PID_FILE, { force: true })
    rmSync(OFFLINE_FLAG, { force: true })
    process.exit(code)
  }

  writeFileSync(PID_FILE, String(process.pid))
  rmSync(OFFLINE_FLAG, { force: true })
  // `pc-host offline` from another window asks through a flag file
  const flagTimer = setInterval(() => { if (existsSync(OFFLINE_FLAG)) void exit('offline', 0) }, 1000)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) process.on(sig, () => { void exit('restart', 0) })
  process.on('uncaughtException', err => {
    world.log.error('crashed', { err: err.stack ?? String(err) })
    // a non-zero exit: the service wrapper starts the app again, which loads the last save
    void exit('restart', 1)
  })
}

function running(): number | null {
  if (!existsSync(PID_FILE)) return null
  const pid = Number(readFileSync(PID_FILE, 'utf8'))
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    process.kill(pid, 0)
    return pid
  } catch {
    return null
  }
}

async function offline(): Promise<void> {
  const pid = running()
  if (pid !== null) {
    writeFileSync(OFFLINE_FLAG, 'offline')
    process.stdout.write('Asked the running host to save and close the world…\n')
    const end = Date.now() + OFFLINE_WAIT_MS
    while (running() !== null && Date.now() < end) await new Promise(r => setTimeout(r, 500))
    if (running() !== null) {
      process.stderr.write('The host did not stop in time; check its log.\n')
      process.exit(1)
    }
    process.stdout.write('Done: the world is closed until the PC runs it again.\n')
    return
  }
  // not running: tell the site directly
  const cfg = config()
  await new HttpSite(cfg.site, cfg.token).heartbeat({ version: VERSION, peer_id: makePeerId(), going: 'offline' })
  process.stdout.write('Done: the site marks the world offline.\n')
}

const command = process.argv[2] ?? 'run'
if (command === 'run') run()
else if (command === 'worker') runWorker(VERSION, APP_DIR)
else if (command === 'service') runService(APP_DIR, VERSION).catch(err => { process.stderr.write(`${String(err)}\n`); process.exit(1) })
else if (command === 'offline') offline().catch(err => { process.stderr.write(`${String(err)}\n`); process.exit(1) })
else {
  process.stderr.write(`Unknown command "${command}". Use: service | run | offline | worker\n`)
  process.exit(2)
}
