/**
 * The host app's config (docs/pc-host-research.md §8): one site, and the global worlds
 * this PC runs — one host key each. The Block Survival Host app writes it to
 * %ProgramData%\BlockSurvivalHost\config.json; the supervisor reads it at start and on
 * every reload. Tokens are stored DPAPI-protected (`tokenProtected`, machine scope, so
 * the service account can read them); a plain `token` is accepted for hand-made configs.
 * A config.json from before many worlds (`site` + `token` at the top) is one world.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConfigError, parseConfig, type Config } from './config'

/** ports a world may use for ICE: four players plus room to spare */
export const PORTS_PER_WORLD = 20
export const DEFAULT_PORT_RANGE: [number, number] = [50000, 50199]
export const DEFAULT_CONTROL_PORT = 47810

export interface WorldEntry {
  /** stable id, also the name of the world's log folder */
  id: string
  /** what the app shows; the site's name for the world is set by the admin */
  name: string
  token?: string
  tokenProtected?: string
  /** start with the service */
  autoStart: boolean
}

export interface HostConfig {
  site: string
  relayOnly: boolean
  /** the UDP range the firewall rule opens; each world gets its own slice of it */
  portRange: [number, number]
  /** the control API's port on 127.0.0.1 */
  controlPort: number
  logDir: string
  worlds: WorldEntry[]
}

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/i

function range(p: unknown, what: string): [number, number] {
  const ok = Array.isArray(p) && p.length === 2 && p.every(n => Number.isInteger(n) && n >= 1024 && n <= 65535) && p[0] <= p[1]
  if (!ok) throw new ConfigError(`"${what}" must be [first, last] ports between 1024 and 65535`)
  return [p[0] as number, p[1] as number]
}

function parseWorld(raw: unknown, i: number): WorldEntry {
  if (typeof raw !== 'object' || raw === null) throw new ConfigError(`worlds[${i}] must be an object`)
  const w = raw as Record<string, unknown>
  if (typeof w.id !== 'string' || !ID.test(w.id)) throw new ConfigError(`worlds[${i}].id must be letters, digits and dashes (up to 32)`)
  if (typeof w.name !== 'string' || w.name.trim() === '' || w.name.length > 32) throw new ConfigError(`worlds[${i}].name must be 1–32 characters`)
  const hasPlain = typeof w.token === 'string' && w.token.length >= 20
  const hasProtected = typeof w.tokenProtected === 'string' && w.tokenProtected.length > 0
  if (!hasPlain && !hasProtected) throw new ConfigError(`worlds[${i}] needs its host token`)
  if (w.autoStart !== undefined && typeof w.autoStart !== 'boolean') throw new ConfigError(`worlds[${i}].autoStart must be true or false`)
  return {
    id: w.id,
    name: w.name.trim(),
    token: hasPlain ? (w.token as string) : undefined,
    tokenProtected: hasProtected ? (w.tokenProtected as string) : undefined,
    autoStart: w.autoStart !== false,
  }
}

export function parseHostConfig(raw: unknown): HostConfig {
  if (typeof raw !== 'object' || raw === null) throw new ConfigError('config.json must hold an object')
  const r = raw as Record<string, unknown>
  if (!('worlds' in r)) {
    // before many worlds: one site, one token
    const single = parseConfig(raw)
    return {
      site: single.site,
      relayOnly: single.relayOnly,
      portRange: single.portRange ?? DEFAULT_PORT_RANGE,
      controlPort: DEFAULT_CONTROL_PORT,
      logDir: single.logDir,
      worlds: [{ id: 'main', name: 'Global world', token: single.token, autoStart: true }],
    }
  }
  // the site rules (https, or http only for a local dev site) are the single-world ones
  const site = parseConfig({ site: r.site, token: 'x'.repeat(48) }).site
  if (r.relayOnly !== undefined && typeof r.relayOnly !== 'boolean') throw new ConfigError('"relayOnly" must be true or false')
  if (r.logDir !== undefined && typeof r.logDir !== 'string') throw new ConfigError('"logDir" must be a folder name')
  const portRange = r.portRange === undefined ? DEFAULT_PORT_RANGE : range(r.portRange, 'portRange')
  let controlPort = DEFAULT_CONTROL_PORT
  if (r.controlPort !== undefined) {
    if (!Number.isInteger(r.controlPort) || (r.controlPort as number) < 1024 || (r.controlPort as number) > 65535) throw new ConfigError('"controlPort" must be a port between 1024 and 65535')
    controlPort = r.controlPort as number
  }
  if (!Array.isArray(r.worlds)) throw new ConfigError('"worlds" must be a list')
  const worlds = r.worlds.map(parseWorld)
  const ids = new Set<string>()
  for (const w of worlds) {
    const key = w.id.toLowerCase()
    if (ids.has(key)) throw new ConfigError(`two worlds share the id "${w.id}"`)
    ids.add(key)
  }
  const slots = Math.floor((portRange[1] - portRange[0] + 1) / PORTS_PER_WORLD)
  if (worlds.length > slots) throw new ConfigError(`"portRange" has room for ${slots} worlds (${PORTS_PER_WORLD} ports each), not ${worlds.length}`)
  return { site, relayOnly: r.relayOnly === true, portRange, controlPort, logDir: (r.logDir as string | undefined) ?? 'logs', worlds }
}

export function loadHostConfig(path: string): HostConfig {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new ConfigError(`No config at ${path} — set the host up in the Block Survival Host app`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    throw new ConfigError(`${path} is not valid JSON`)
  }
  return parseHostConfig(raw)
}

/** the slice of the port range the world at `index` uses */
export function worldPorts(cfg: HostConfig, index: number): [number, number] {
  const first = cfg.portRange[0] + index * PORTS_PER_WORLD
  return [first, first + PORTS_PER_WORLD - 1]
}

/**
 * What one world's process runs with: the single-world config, its token in the clear
 * (it only ever travels over IPC, never to disk), its ports and its own log folder.
 */
export async function worldConfig(cfg: HostConfig, world: WorldEntry, home: string, unprotect: (b64: string) => Promise<string>): Promise<Config> {
  const token = world.token ?? await unprotect(world.tokenProtected!)
  const index = cfg.worlds.findIndex(w => w.id === world.id)
  return parseConfig({
    site: cfg.site,
    token,
    portRange: worldPorts(cfg, Math.max(0, index)),
    relayOnly: cfg.relayOnly,
    logDir: join(home, cfg.logDir, world.id),
  })
}
