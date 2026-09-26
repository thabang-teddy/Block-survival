/**
 * config.json next to the app: where the site is, the host token from the admin page,
 * and how WebRTC may use this PC's network.
 */
import { readFileSync } from 'node:fs'

export interface Config {
  /** the site's address, e.g. https://blocksurvival.example */
  site: string
  /** the host token, shown once on the admin dashboard when the host PC was created */
  token: string
  /** the UDP ports ICE may use; forward them on the router if there is no CGNAT (optional) */
  portRange?: [number, number]
  /** relay-only ICE: players never see this PC's address, at a small cost in latency */
  relayOnly: boolean
  /** where the rolling log goes, relative to the app folder */
  logDir: string
}

export class ConfigError extends Error {}

/** plain http only to this machine: localhost, 127.0.0.1, or a `.test` dev site (Herd) — the whole hostname, then a port, a path or the end */
const LOCAL_HTTP = /^http:\/\/(localhost|127\.0\.0\.1|[a-z0-9-]+(\.[a-z0-9-]+)*\.test)(:\d+)?(\/|$)/i

export function parseConfig(raw: unknown): Config {
  if (typeof raw !== 'object' || raw === null) throw new ConfigError('config.json must hold an object')
  const r = raw as Record<string, unknown>
  if (typeof r.site !== 'string' || !/^https?:\/\/[^/]+/.test(r.site)) throw new ConfigError('"site" must be the site\'s http(s) address')
  if (!r.site.startsWith('https://') && !LOCAL_HTTP.test(r.site)) {
    throw new ConfigError('"site" must use https (plain http is only for localhost or a .test dev site)')
  }
  if (typeof r.token !== 'string' || r.token.length < 20) throw new ConfigError('"token" must be the host token from the admin page')
  let portRange: [number, number] | undefined
  if (r.portRange !== undefined) {
    const p = r.portRange
    const ok = Array.isArray(p) && p.length === 2 && p.every(n => Number.isInteger(n) && n >= 1024 && n <= 65535) && p[0] <= p[1]
    if (!ok) throw new ConfigError('"portRange" must be [first, last] UDP ports between 1024 and 65535')
    portRange = [p[0] as number, p[1] as number]
  }
  if (r.relayOnly !== undefined && typeof r.relayOnly !== 'boolean') throw new ConfigError('"relayOnly" must be true or false')
  if (r.logDir !== undefined && typeof r.logDir !== 'string') throw new ConfigError('"logDir" must be a folder name')
  return { site: r.site, token: r.token, portRange, relayOnly: r.relayOnly === true, logDir: (r.logDir as string | undefined) ?? 'logs' }
}

export function loadConfig(path: string): Config {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new ConfigError(`No config at ${path} — copy config.example.json to config.json and fill it in`)
  }
  try {
    return parseConfig(JSON.parse(text))
  } catch (err) {
    if (err instanceof ConfigError) throw err
    throw new ConfigError(`${path} is not valid JSON`)
  }
}
