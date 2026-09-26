/**
 * `pc-host service`: what the Windows service runs (docs/pc-host-research.md §8). It
 * reads config.json from the data folder (PC_HOST_HOME, set by the service definition —
 * %ProgramData%\BlockSurvivalHost when installed), runs one worker per world, and serves
 * the control API the Block Survival Host app uses. A broken config does not stop the
 * service: it runs no worlds and says what is wrong, so the app can fix it and reload.
 */
import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigError } from '../config'
import { DEFAULT_CONTROL_PORT, loadHostConfig, worldConfig, worldPorts, type HostConfig, type WorldEntry } from '../hostConfig'
import { FileLog } from '../log'
import { startControl } from './control'
import { unprotect } from './dpapi'
import { Supervisor, type FromWorker, type SupervisedWorld, type ToWorker, type WorkerHandle } from './Supervisor'

/** stopping the service: each world saves and says `restart` (players stay paused) */
const SERVICE_STOP_MS = 25_000

export function controlKey(home: string): string {
  const file = join(home, 'control.key')
  if (existsSync(file)) {
    const key = readFileSync(file, 'utf8').trim()
    if (key.length >= 32) return key
  }
  const key = randomBytes(32).toString('hex')
  writeFileSync(file, key, { encoding: 'utf8', mode: 0o600 })
  return key
}

export function tailLines(file: string, lines: number): string[] {
  if (!existsSync(file)) return []
  const text = readFileSync(file, 'utf8')
  return text.split('\n').filter(l => l.length > 0).slice(-lines)
}

/** what changed between two configs, world by world: those worlds restart if running */
export function changedWorlds(before: HostConfig | null, after: HostConfig): Set<string> {
  const changed = new Set<string>()
  if (!before) return changed
  const shared = (c: HostConfig) => JSON.stringify([c.site, c.relayOnly, c.portRange, c.logDir])
  after.worlds.forEach((w, i) => {
    const old = before.worlds.find(o => o.id === w.id)
    if (!old) return
    const oldIndex = before.worlds.indexOf(old)
    const same = shared(before) === shared(after)
      && old.token === w.token && old.tokenProtected === w.tokenProtected
      && JSON.stringify(worldPorts(before, oldIndex)) === JSON.stringify(worldPorts(after, i))
    if (!same) changed.add(w.id)
  })
  return changed
}

function forkWorker(bundle: string, world: SupervisedWorld, log: FileLog): WorkerHandle {
  const child = fork(bundle, ['worker'], { execPath: process.execPath, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true })
  child.stderr?.on('data', (d: Buffer) => log.error('worker stderr', { world: world.id, text: d.toString().slice(0, 2000) }))
  return {
    pid: child.pid,
    send: (msg: ToWorker) => { if (child.connected) child.send(msg) },
    kill: () => { child.kill() },
    onMessage: cb => { child.on('message', m => cb(m as FromWorker)) },
    onExit: cb => { child.on('exit', code => cb(code)) },
  }
}

export async function runService(appDir: string, version: string): Promise<void> {
  const home = process.env.PC_HOST_HOME ?? appDir
  const configPath = join(home, 'config.json')
  const log = new FileLog(join(home, 'logs'), true, 'service.log')
  const bundle = fileURLToPath(import.meta.url)
  let cfg = null as HostConfig | null
  let problem: string | null = null

  const supervisor = new Supervisor({
    spawn: world => forkWorker(bundle, world, log),
    async configFor(world) {
      const entry = cfg?.worlds.find(w => w.id === world.id)
      if (!cfg || !entry) throw new Error('This world is no longer in the config.')
      return worldConfig(cfg, entry, home, unprotect)
    },
    log,
  })

  const toSupervised = (w: WorldEntry): SupervisedWorld => ({ id: w.id, name: w.name, autoStart: w.autoStart })

  async function reload(): Promise<void> {
    let next: HostConfig
    try {
      next = loadHostConfig(configPath)
    } catch (err) {
      problem = err instanceof ConfigError ? err.message : String(err)
      log.error('config problem', { problem })
      throw new ConfigError(problem)
    }
    const changed = changedWorlds(cfg, next)
    cfg = next
    problem = null
    await supervisor.load(next.worlds.map(toSupervised), changed)
    log.info('config loaded', { worlds: next.worlds.map(w => w.id) })
  }

  log.info('service starting', { version, home })
  await reload().catch(() => {})
  const key = controlKey(home)
  const server = await startControl(cfg?.controlPort ?? DEFAULT_CONTROL_PORT, {
    supervisor,
    key,
    version,
    reload,
    problem: () => problem,
    logTail: (id, lines) => tailLines(join(home, cfg?.logDir ?? 'logs', id, 'pc-host.log'), lines),
    log,
  })

  let exiting = false
  const exit = async () => {
    if (exiting) return
    exiting = true
    log.info('service stopping: every world pauses until it is back')
    server.close()
    const timeout = new Promise(r => setTimeout(r, SERVICE_STOP_MS))
    await Promise.race([supervisor.stopAll('restart'), timeout])
    process.exit(0)
  }
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) process.on(sig, () => { void exit() })
  process.on('uncaughtException', err => {
    log.error('the service crashed', { err: err.stack ?? String(err) })
    // WinSW starts it again; the workers see the disconnect and pause their worlds
    process.exit(1)
  })
}
