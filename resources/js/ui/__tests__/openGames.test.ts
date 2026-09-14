import { describe, expect, test } from 'vitest'
import { isJoinable, seatsText, sortOpenRooms } from '../openGames'
import { browserName, when } from '../admin/types'
import type { OpenRoom } from '../../net/api'

const NOW = Date.parse('2026-09-13T20:00:00Z')
const room = (code: string, players: number, expiresInMin: number): OpenRoom => ({
  code, host_name: `host-${code}`, players, max_players: 4,
  expires_at: new Date(NOW + expiresInMin * 60_000).toISOString(),
})

describe('open games list', () => {
  test('a room is joinable while it has a free seat and has not expired', () => {
    expect(isJoinable(room('AAAAAA', 3, 30), NOW)).toBe(true)
    expect(isJoinable(room('BBBBBB', 4, 30), NOW)).toBe(false)
    expect(isJoinable(room('CCCCCC', 1, -1), NOW)).toBe(false)
  })

  test('seats read as taken/max', () => {
    expect(seatsText(room('AAAAAA', 2, 30))).toBe('2/4')
  })

  test('the list drops full or expired rooms and shows the freshest first', () => {
    const sorted = sortOpenRooms([room('OLD', 1, 10), room('FULL', 4, 60), room('NEW', 2, 90), room('DEAD', 1, -5)], NOW)
    expect(sorted.map(r => r.code)).toEqual(['NEW', 'OLD'])
  })
})

describe('admin helpers', () => {
  test('browserName picks the family and OS out of a user agent', () => {
    expect(browserName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 Edg/128.0')).toBe('Edge on Windows')
    expect(browserName('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15')).toBe('Safari on macOS')
    expect(browserName('Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0')).toBe('Firefox on Linux')
    expect(browserName(null)).toBe('Unknown browser')
  })

  test('when() tolerates a missing timestamp', () => {
    expect(when(null)).toBe('—')
    expect(when('2026-09-13T20:00:00Z')).toMatch(/13/)
  })
})
