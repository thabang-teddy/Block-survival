import { describe, expect, test } from 'vitest'
import { isJoinable, seatsText, sortInvites, worldLabel } from '../invites'
import { browserName, when } from '../admin/types'
import type { Invite } from '../../net/api'
import { GLOBAL_SEED, newWorldSeed, seedTag } from '../../world/seed'
import { statusOf } from '../InvitePanel'

const NOW = Date.parse('2026-09-13T20:00:00Z')
const invite = (code: string, players: number, expiresInMin: number, status: Invite['status'] = 'pending'): Invite => ({
  id: code.charCodeAt(0), code, host_name: `host-${code}`, world_kind: 'own', players, max_players: 4,
  expires_at: new Date(NOW + expiresInMin * 60_000).toISOString(), status,
})

describe('invitations list', () => {
  test('an invite is joinable while pending or accepted, with a free seat, before the room expires', () => {
    expect(isJoinable(invite('AAAAAA', 3, 30), NOW)).toBe(true)
    expect(isJoinable(invite('BBBBBB', 4, 30), NOW)).toBe(false)
    expect(isJoinable(invite('CCCCCC', 1, -1), NOW)).toBe(false)
    expect(isJoinable(invite('DDDDDD', 1, 30, 'declined'), NOW)).toBe(false)
    // accepted earlier: the invitee left and can go back in
    expect(isJoinable(invite('EEEEEE', 1, 30, 'accepted'), NOW)).toBe(true)
  })

  test('seats read as taken/max', () => {
    expect(seatsText(invite('AAAAAA', 2, 30))).toBe('2/4')
  })

  test('the list drops full, expired or answered invites and shows the freshest first', () => {
    const sorted = sortInvites([invite('OLD', 1, 10), invite('FULL', 4, 60), invite('NEW', 2, 90), invite('DEAD', 1, -5), invite('NO', 1, 50, 'declined')], NOW)
    expect(sorted.map(r => r.code)).toEqual(['NEW', 'OLD'])
  })

  test('the world label names the host or the global world', () => {
    expect(worldLabel('own', 'Sam')).toBe("Sam's world")
    expect(worldLabel('global', 'Sam')).toBe('the global world')
  })
})

describe('host invite panel', () => {
  test('a player reads as joined, then by their invite, then as invitable', () => {
    const invites = [
      { id: 1, user_id: 2, name: 'Sam', status: 'pending' as const },
      { id: 2, user_id: 3, name: 'Kim', status: 'accepted' as const },
      { id: 3, user_id: 4, name: 'Lee', status: 'declined' as const },
    ]
    expect(statusOf({ id: 2, name: 'Sam' }, invites, [])).toBe('pending')
    expect(statusOf({ id: 3, name: 'Kim' }, invites, ['Kim'])).toBe('joined')
    expect(statusOf({ id: 3, name: 'Kim' }, invites, [])).toBe('accepted')
    expect(statusOf({ id: 4, name: 'Lee' }, invites, [])).toBe('declined')
    expect(statusOf({ id: 9, name: 'New' }, invites, [])).toBe('invite')
  })
})

describe('world seeds', () => {
  test('a new own world never gets the global seed and differs across calls', () => {
    const seeds = new Set<number>()
    for (let i = 0; i < 100; i++) seeds.add(newWorldSeed())
    expect(seeds.size).toBeGreaterThan(90)
    for (const s of seeds) {
      expect(s).not.toBe(GLOBAL_SEED)
      expect(Number.isInteger(s)).toBe(true)
      expect(s).toBeGreaterThan(0)
      expect(s).toBeLessThan(2 ** 31)
    }
  })

  test('a random source that lands on the global seed is skipped', () => {
    const values = [GLOBAL_SEED / 0x7fffffff, 0, 0.5]
    let i = 0
    expect(newWorldSeed(() => values[i++])).toBe(Math.floor(0.5 * 0x7fffffff))
  })

  test('seed tags are short hex', () => {
    expect(seedTag(11)).toBe('#00000b')
    expect(seedTag(0x1a2b3c4d)).toBe('#2b3c4d')
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
