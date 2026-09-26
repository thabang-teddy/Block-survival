import { describe, expect, test } from 'vitest'
import { ConfigError, parseConfig } from '../src/config'

const token = 'x'.repeat(48)

describe('config.json', () => {
  test('a minimal config gets its defaults', () => {
    expect(parseConfig({ site: 'https://game.example', token })).toEqual({
      site: 'https://game.example', token, portRange: undefined, relayOnly: false, logDir: 'logs',
    })
    expect(parseConfig({ site: 'http://localhost:8000', token, portRange: [50000, 50100], relayOnly: true }).portRange).toEqual([50000, 50100])
    // a Herd dev site
    expect(parseConfig({ site: 'http://block-survival.test', token }).site).toBe('http://block-survival.test')
    expect(parseConfig({ site: 'http://app.block-survival.test:8080/', token }).site).toBe('http://app.block-survival.test:8080/')
  })

  test('mistakes are explained', () => {
    expect(() => parseConfig(null)).toThrow(ConfigError)
    expect(() => parseConfig({ site: 'game.example', token })).toThrow(/address/)
    // the token must never travel in the clear to a real site
    expect(() => parseConfig({ site: 'http://game.example', token })).toThrow(/https/)
    // only the whole hostname counts: these are real sites dressed up as local ones
    expect(() => parseConfig({ site: 'http://localhost.game.example', token })).toThrow(/https/)
    expect(() => parseConfig({ site: 'http://block-survival.test.game.example', token })).toThrow(/https/)
    expect(() => parseConfig({ site: 'http://127.0.0.1.nip.io', token })).toThrow(/https/)
    expect(() => parseConfig({ site: 'https://game.example', token: 'short' })).toThrow(/token/)
    expect(() => parseConfig({ site: 'https://game.example', token, portRange: [50100, 50000] })).toThrow(/portRange/)
    expect(() => parseConfig({ site: 'https://game.example', token, portRange: [80, 90] })).toThrow(/portRange/)
    expect(() => parseConfig({ site: 'https://game.example', token, relayOnly: 'yes' })).toThrow(/relayOnly/)
  })
})
