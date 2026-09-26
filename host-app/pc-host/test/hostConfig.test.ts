import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { ConfigError } from '../src/config'
import { DEFAULT_CONTROL_PORT, DEFAULT_PORT_RANGE, parseHostConfig, PORTS_PER_WORLD, worldConfig, worldPorts } from '../src/hostConfig'
import { changedWorlds } from '../src/supervisor/service'

const token = 'x'.repeat(48)
const base = { site: 'https://game.example', worlds: [{ id: 'home', name: 'Home', token }] }

describe('the host config', () => {
  test('a single-world config.json from before is one world', () => {
    const cfg = parseHostConfig({ site: 'https://game.example', token, portRange: [50000, 50100], relayOnly: true })
    expect(cfg).toEqual({
      site: 'https://game.example', relayOnly: true, portRange: [50000, 50100], controlPort: DEFAULT_CONTROL_PORT, logDir: 'logs',
      worlds: [{ id: 'main', name: 'Global world', token, autoStart: true }],
    })
  })

  test('several worlds get their defaults', () => {
    const cfg = parseHostConfig({ ...base, worlds: [...base.worlds, { id: 'attic', name: 'Attic', tokenProtected: 'AQAAAN==', autoStart: false }] })
    expect(cfg.portRange).toEqual(DEFAULT_PORT_RANGE)
    expect(cfg.worlds).toEqual([
      { id: 'home', name: 'Home', token, tokenProtected: undefined, autoStart: true },
      { id: 'attic', name: 'Attic', token: undefined, tokenProtected: 'AQAAAN==', autoStart: false },
    ])
  })

  test('each world gets its own slice of the port range', () => {
    const cfg = parseHostConfig({ ...base, portRange: [50000, 50059] })
    expect(worldPorts(cfg, 0)).toEqual([50000, 50000 + PORTS_PER_WORLD - 1])
    expect(worldPorts(cfg, 2)).toEqual([50040, 50059])
  })

  test('mistakes are explained', () => {
    expect(() => parseHostConfig({ ...base, site: 'http://game.example' })).toThrow(/https/)
    expect(() => parseHostConfig({ ...base, worlds: 'home' })).toThrow(/list/)
    expect(() => parseHostConfig({ ...base, worlds: [{ id: 'has space', name: 'x', token }] })).toThrow(/id/)
    expect(() => parseHostConfig({ ...base, worlds: [{ id: 'home', name: '', token }] })).toThrow(/name/)
    expect(() => parseHostConfig({ ...base, worlds: [{ id: 'home', name: 'Home' }] })).toThrow(/token/)
    expect(() => parseHostConfig({ ...base, worlds: [{ id: 'a', name: 'A', token }, { id: 'A', name: 'B', token }] })).toThrow(/share/)
    expect(() => parseHostConfig({ ...base, portRange: [50000, 50019], worlds: [{ id: 'a', name: 'A', token }, { id: 'b', name: 'B', token }] })).toThrow(/room for 1/)
    expect(() => parseHostConfig({ ...base, controlPort: 80 })).toThrow(/controlPort/)
    expect(() => parseHostConfig({ ...base, relayOnly: 'yes' })).toThrow(ConfigError)
  })

  test('a world runs with its token, its ports and its own log folder', async () => {
    const cfg = parseHostConfig({ ...base, worlds: [...base.worlds, { id: 'attic', name: 'Attic', tokenProtected: 'CIPHER' }] })
    const unprotect = async (b64: string) => (b64 === 'CIPHER' ? 'y'.repeat(48) : '')
    const attic = await worldConfig(cfg, cfg.worlds[1], 'C:/data', unprotect)
    expect(attic).toEqual({ site: 'https://game.example', token: 'y'.repeat(48), portRange: [50020, 50039], relayOnly: false, logDir: join('C:/data', 'logs', 'attic') })
  })

  test('a reload restarts only the worlds whose settings changed', () => {
    const before = parseHostConfig({ ...base, worlds: [{ id: 'home', name: 'Home', token }, { id: 'attic', name: 'Attic', token }] })
    const renamed = parseHostConfig({ ...base, worlds: [{ id: 'home', name: 'Home PC', token }, { id: 'attic', name: 'Attic', token: 'z'.repeat(48) }] })
    expect([...changedWorlds(before, renamed)]).toEqual(['attic'])
    // removing the first world moves the second's ports
    const shifted = parseHostConfig({ ...base, worlds: [{ id: 'attic', name: 'Attic', token }] })
    expect([...changedWorlds(before, shifted)]).toEqual(['attic'])
    expect([...changedWorlds(before, parseHostConfig({ ...base, relayOnly: true, worlds: before.worlds }))]).toEqual(['home', 'attic'])
    expect(changedWorlds(null, before).size).toBe(0)
  })
})
