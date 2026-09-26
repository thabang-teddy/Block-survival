/**
 * One world, run in this process: the PcHost with its real site, WebRTC, log and
 * keep-awake helper. `pc-host run` (one world, from a window or the old single-world
 * service) and each supervised worker (`pc-host worker`) both use it.
 */
import { resolve } from 'node:path'
import { RTCPeerConnection } from 'node-datachannel/polyfill'
import type { Config } from './config'
import { FileLog } from './log'
import { KeepAwake } from './power'
import { PcHost } from './PcHost'
import { HttpSite } from './site'

/** a site that is down at boot is asked again this often; nobody can play meanwhile anyway */
const START_RETRY_MS = 30_000

export interface RunningWorld {
  host: PcHost
  log: FileLog
  /** save, tell the site, and release the PC; safe to call twice */
  stop(going: 'offline' | 'restart'): Promise<void>
}

export interface RunWorldOptions {
  version: string
  /** where a relative logDir is taken from */
  appDir: string
  /** mirror the log to stdout (a window or WinSW's log) */
  echo: boolean
  /** the token was refused: nothing more this process can do */
  onRevoked(): void
}

export function runWorld(cfg: Config, opts: RunWorldOptions): RunningWorld {
  const log = new FileLog(resolve(opts.appDir, cfg.logDir), opts.echo)
  const power = new KeepAwake(msg => log.error(msg))
  const site = new HttpSite(cfg.site, cfg.token)
  const host = new PcHost({
    site,
    version: opts.version,
    makePeer: c => new RTCPeerConnection(c) as unknown as globalThis.RTCPeerConnection,
    transport: { portRange: cfg.portRange, relayOnly: cfg.relayOnly },
    log,
    keepAwake: on => power.set(on),
    onRevoked: opts.onRevoked,
  })
  let stopping: Promise<void> | null = null
  let stopped = false

  log.info('starting', { version: opts.version, site: cfg.site, portRange: cfg.portRange, relayOnly: cfg.relayOnly })
  void (async () => {
    while (!stopped) {
      try {
        await host.start()
        return
      } catch (err) {
        log.error(`could not start; retrying in ${START_RETRY_MS / 1000} s`, { err: String(err) })
        await new Promise(r => setTimeout(r, START_RETRY_MS))
      }
    }
  })()

  return {
    host,
    log,
    stop(going) {
      stopped = true
      stopping ??= host.stop(going)
        .catch(err => log.error('stopping failed', { err: String(err) }))
        .finally(() => power.release())
      return stopping
    },
  }
}
