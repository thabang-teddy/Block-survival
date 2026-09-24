import { describe, expect, test, vi } from 'vitest'
import { joinRoom, playWorld, rejoin, type PlayDeps } from '../play'
import { socketUrl, type ClientSession } from '../ClientSession'
import type { PlayTicket } from '../api'

const ticket = (code: string, kind: 'own' | 'global' = 'own'): PlayTicket => ({
  room: { code, host_peer_id: 'server', host_name: 'Sam', world_kind: kind, players: 1, expires_at: '' },
  ticket: `t-${code}`,
})

function deps(): PlayDeps & { connect: ReturnType<typeof vi.fn> } {
  return {
    play: vi.fn(async (world: 'own' | 'global') => ticket(world === 'own' ? 'OWNNNN' : 'GLOBAL', world)),
    join: vi.fn(async (code: string) => ticket(code)),
    connect: vi.fn(async (code: string) => ({ code, dispose() {} }) as unknown as ClientSession),
  }
}

describe('play', () => {
  test('the own world makes the player its owner; the global world does not', async () => {
    const d = deps()
    const own = await playWorld('own', 'Sam', d)
    expect(own).toMatchObject({ name: 'Sam', worldKind: 'own', owner: true })
    expect(d.connect).toHaveBeenCalledWith('OWNNNN', 'Sam', 't-OWNNNN')
    const global = await playWorld('global', 'Sam', d)
    expect(global).toMatchObject({ worldKind: 'global', owner: false })
  })

  test('an invitation joins the room by code', async () => {
    const d = deps()
    const launch = await joinRoom('FRIEND', 'Sam', 'own', d)
    expect(d.join).toHaveBeenCalledWith('FRIEND')
    expect(launch).toMatchObject({ worldKind: 'own', owner: false })
    expect(launch.session.code).toBe('FRIEND')
  })

  test('rejoining enters our own and the global world again, and dials a friend by code', async () => {
    const d = deps()
    const own = await playWorld('own', 'Sam', d)
    await rejoin(own, d)
    expect(d.play).toHaveBeenLastCalledWith('own')
    const friend = await joinRoom('FRIEND', 'Sam', 'own', d)
    await rejoin(friend, d)
    expect(d.join).toHaveBeenLastCalledWith('FRIEND')
  })
})

describe('socketUrl', () => {
  test('follows the page: wss on https, ws on http, the ticket escaped', () => {
    expect(socketUrl('a+b', { protocol: 'https:', host: 'game.example' })).toBe('wss://game.example/ws?ticket=a%2Bb')
    expect(socketUrl('x', { protocol: 'http:', host: 'localhost:3333' })).toBe('ws://localhost:3333/ws?ticket=x')
  })
})
