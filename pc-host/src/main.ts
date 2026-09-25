/**
 * pc-host — hosts the Block Survival global world on this PC (docs/pc-host-research.md).
 *
 *   node dist/pc-host.mjs            run: register with the site and host the world
 *   node dist/pc-host.mjs offline    hand the world to the players' browsers and stop
 *
 * Stopping the process any other way (Ctrl+C, Windows stopping the service for an update
 * or a reboot) saves the world and keeps the players paused until the PC is back.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RTCPeerConnection } from 'node-datachannel/polyfill'
import { loadConfig, ConfigError, type Config } from './config'
import { FileLog } from './log'
import { KeepAwake } from './power'
import { makePeerId, PcHost } from './PcHost'
import { HttpSite } from './site'

declare const __PC_HOST_VERSION__: string
const VERSION = typeof __PC_HOST_VERSION__ === 'string' ? __PC_HOST_VERSION__ : '0.0.0-dev'

/** the folder holding config.json, logs and the pid file: dist/.. */
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

async function run(): Promise<void> {
  const cfg = config()
  const log = new FileLog(resolve(APP_DIR, cfg.logDir))
  const power = new KeepAwake(msg => log.error(msg))
  const site = new HttpSite(cfg.site, cfg.token)
  let exiting = false
  const host = new PcHost({
    site,
    version: VERSION,
    makePeer: c => new RTCPeerConnection(c) as unknown as globalThis.RTCPeerConnection,
    transport: { portRange: cfg.portRange, relayOnly: cfg.relayOnly },
    log,
    keepAwake: on => power.set(on),
    onRevoked: () => { void exit('restart', 0) },
  })

  async function exit(going: 'offline' | 'restart', code: number): Promise<void> {
    if (exiting) return
    exiting = true
    clearInterval(flagTimer)
    await host.stop(going).catch(err => log.error('stopping failed', { err: String(err) }))
    power.release()
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
    log.error('crashed', { err: err.stack ?? String(err) })
    // a non-zero exit: the service wrapper starts the app again, which loads the last save
    void exit('restart', 1)
  })

  log.info('starting', { version: VERSION, site: cfg.site, portRange: cfg.portRange, relayOnly: cfg.relayOnly })
  for (;;) {
    try {
      await host.start()
      return
    } catch (err) {
      // the site is down or unreachable at boot: keep trying, nobody can play meanwhile anyway
      log.error('could not start; retrying in 30 s', { err: String(err) })
      await new Promise(r => setTimeout(r, 30_000))
    }
  }
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
    process.stdout.write('Asked the running host to save and hand the world to the browsers…\n')
    const end = Date.now() + OFFLINE_WAIT_MS
    while (running() !== null && Date.now() < end) await new Promise(r => setTimeout(r, 500))
    if (running() !== null) {
      process.stderr.write('The host did not stop in time; check its log.\n')
      process.exit(1)
    }
    process.stdout.write('Done: the browsers host the global world until the PC runs again.\n')
    return
  }
  // not running: tell the site directly
  const cfg = config()
  await new HttpSite(cfg.site, cfg.token).heartbeat({ version: VERSION, peer_id: makePeerId(), going: 'offline' })
  process.stdout.write('Done: the site hands the global world to the browsers.\n')
}

const command = process.argv[2] ?? 'run'
if (command === 'run') void run()
else if (command === 'offline') offline().catch(err => { process.stderr.write(`${String(err)}\n`); process.exit(1) })
else {
  process.stderr.write(`Unknown command "${command}". Use: run | offline\n`)
  process.exit(2)
}
