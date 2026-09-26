import { describe, expect, test, vi } from 'vitest'
import { ApiError, type GlobalState, type SaveData, type SavedPlayer } from '../api'
import { awaitHostPc, CLAIM_POLL_MS, enterGlobal, HANDOVER_TIMEOUT_MS, handover, PAUSE_POLL_MS, PAUSED_TEXT, reconnectGlobal, rejoinRoom, type GlobalWorldDeps } from '../globalWorld'
import { GLOBAL_SEED } from '../../world/seed'
import type { HostSession } from '../HostSession'

const room = (code: string) => ({ code, host_peer_id: `peer-${code}`, host_name: 'Ana', world_kind: 'global' as const, players: 1, expires_at: '' })
const host: GlobalState = { status: 'host', online: 1 }
const client = (code: string): GlobalState => ({ status: 'client', room: room(code), online: 2 })
const pending: GlobalState = { status: 'pending', host_name: 'Ana', online: 2 }
const pc = (code: string): GlobalState => ({ status: 'client', host: 'pc', room: { ...room(code), host_name: 'HomePC' }, online: 2 })
const paused: GlobalState = { status: 'paused', host: 'pc', host_name: 'HomePC', online: 2 }

const save: SaveData = {
  version: 3, seed: GLOBAL_SEED, time: 100, edits: [], savedAt: 0, zombies: [], drops: [], crates: [],
  players: { '7': { name: 'Me', inventory: [], spawn: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, health: 3, magazine: 0, kills: 0, deaths: 0 } },
}
const mine: SavedPlayer = { ...save.players['7'], health: 20, kills: 9, pos: { x: 5, y: 6, z: 7, yaw: 1, pitch: 0 } }

/** a fake of everything the flow touches; `states` are the server's answers in order (the last one repeats) */
function fakeDeps(states: GlobalState[], saved: SaveData | null = save) {
  let clock = 0
  const answers = [...states]
  const next = () => Promise.resolve(answers.length > 1 ? answers.shift()! : answers[0])
  const hostSession = { kind: 'host' } as unknown as HostSession
  const deps: GlobalWorldDeps = {
    userId: 7,
    join: vi.fn(next),
    claim: vi.fn(next),
    loadWorld: vi.fn(async () => saved),
    openRoom: vi.fn(async () => hostSession),
    connect: vi.fn(async (code: string) => ({ kind: 'client', code }) as never),
    sleep: vi.fn(async (ms: number) => { clock += ms }),
    now: () => clock,
    onStatus: vi.fn(),
  }
  return { deps, hostSession }
}

describe('enterGlobal', () => {
  test('the first one in hosts the saved world', async () => {
    const { deps, hostSession } = fakeDeps([host])
    const launch = await enterGlobal('Me', deps)
    expect(launch).toMatchObject({ role: 'host', worldKind: 'global', seed: GLOBAL_SEED, session: hostSession, restore: save })
    expect(deps.loadWorld).toHaveBeenCalledOnce()
    expect(deps.openRoom).toHaveBeenCalledWith('Me')
    expect(deps.claim).not.toHaveBeenCalled()
  })

  test('a fresh world has nothing to restore', async () => {
    const { deps } = fakeDeps([host], null)
    const launch = await enterGlobal('Me', deps)
    expect(launch).toMatchObject({ role: 'host', restore: undefined })
  })

  test('joins the open room when someone is already hosting', async () => {
    const { deps } = fakeDeps([client('ABCDEF')])
    const launch = await enterGlobal('Me', deps)
    expect(launch).toMatchObject({ role: 'client', worldKind: 'global', session: { code: 'ABCDEF' } })
    expect(deps.connect).toHaveBeenCalledWith('ABCDEF', 'Me', 'browser')
    expect(deps.loadWorld).not.toHaveBeenCalled()
  })

  test('waits for a chosen host to open their room, saying so', async () => {
    const { deps } = fakeDeps([pending, pending, client('ABCDEF')])
    const launch = await enterGlobal('Me', deps)
    expect(launch).toMatchObject({ role: 'client', session: { code: 'ABCDEF' } })
    expect(deps.join).toHaveBeenCalledOnce()
    expect(deps.claim).toHaveBeenCalledTimes(2)
    expect(deps.sleep).toHaveBeenCalledWith(CLAIM_POLL_MS)
    expect(deps.onStatus).toHaveBeenCalledWith('Waiting for Ana to open the world…')
  })

  test('the wait can end with me hosting after all', async () => {
    const { deps } = fakeDeps([pending, host])
    const launch = await enterGlobal('Me', deps)
    expect(launch).toMatchObject({ role: 'host' })
  })

  test('gives up when nobody opens a room in time', async () => {
    const { deps } = fakeDeps([pending])
    await expect(enterGlobal('Me', deps)).rejects.toThrow(/nobody/i)
    expect(deps.now()).toBeGreaterThanOrEqual(HANDOVER_TIMEOUT_MS)
  })

  test('a refusal from the server is the error the lobby shows', async () => {
    const { deps } = fakeDeps([host])
    deps.join = vi.fn(async () => { throw new Error('The global world is full right now') })
    await expect(enterGlobal('Me', deps)).rejects.toThrow('full')
  })
})

describe('handover', () => {
  test('the next in line becomes host and keeps their own gear over the stale save', async () => {
    const { deps } = fakeDeps([host])
    const launch = await handover('Me', mine, 'OLDOLD', deps)
    expect(launch.role).toBe('host')
    if (launch.role !== 'host') return
    expect(launch.restore?.players['7']).toEqual(mine)
    expect(launch.restore?.time).toBe(100)
    expect(save.players['7'].health).toBe(3) // the save object itself is untouched
  })

  test('with no save yet the new host starts the world fresh', async () => {
    const { deps } = fakeDeps([host], null)
    const launch = await handover('Me', mine, 'OLDOLD', deps)
    expect(launch).toMatchObject({ role: 'host', restore: undefined })
  })

  test('the others wait for the new room and ignore an answer that still names the old one', async () => {
    const { deps } = fakeDeps([client('OLDOLD'), pending, client('NEWNEW')])
    const launch = await handover('Me', mine, 'OLDOLD', deps)
    expect(launch).toMatchObject({ role: 'client', session: { code: 'NEWNEW' } })
    expect(deps.claim).toHaveBeenCalledTimes(3)
    expect(deps.join).not.toHaveBeenCalled()
  })

  test('a player the server no longer seats is sent back to the lobby', async () => {
    const { deps } = fakeDeps([host])
    deps.claim = vi.fn(async () => { throw new Error('You are not in the global world') })
    await expect(handover('Me', mine, 'OLDOLD', deps)).rejects.toThrow('not in the global world')
  })
})

describe('reconnectGlobal', () => {
  test('a seat still held connects to whoever hosts now — the same room included', async () => {
    const { deps } = fakeDeps([client('ABCDEF')])
    const launch = await reconnectGlobal('Me', mine, deps)
    expect(launch).toMatchObject({ role: 'client', worldKind: 'global', session: { code: 'ABCDEF' } })
    expect(deps.claim).toHaveBeenCalledOnce()
    expect(deps.join).not.toHaveBeenCalled()
  })

  test('a seat that was swept while the tab was away is taken again from the back of the queue', async () => {
    const { deps } = fakeDeps([host])
    deps.claim = vi.fn(async () => { throw new ApiError(404, 'You are not in the global world') })
    const launch = await reconnectGlobal('Me', mine, deps)
    expect(launch.role).toBe('host')
    if (launch.role !== 'host') return
    expect(deps.join).toHaveBeenCalledOnce()
    expect(launch.restore?.players['7']).toEqual(mine) // our gear as we last saw it, over the stale save
  })

  test('any other refusal is the error the overlay shows', async () => {
    const { deps } = fakeDeps([host])
    deps.claim = vi.fn(async () => { throw new ApiError(0, 'Could not reach the server') })
    await expect(reconnectGlobal('Me', mine, deps)).rejects.toThrow('Could not reach the server')
    expect(deps.join).not.toHaveBeenCalled()
  })
})

describe('rejoinRoom', () => {
  test('dials the same room again and keeps the kind of world it was', async () => {
    const { deps } = fakeDeps([host])
    const launch = await rejoinRoom('FRIEND', 'Me', 'own', deps)
    expect(launch).toMatchObject({ role: 'client', worldKind: 'own', session: { code: 'FRIEND' } })
    expect(deps.connect).toHaveBeenCalledWith('FRIEND', 'Me', 'browser')
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.join).not.toHaveBeenCalled()
  })
})

describe('the host PC (docs/pc-host-research.md)', () => {
  test('entering while the PC hosts joins it as a PC-hosted session', async () => {
    const { deps } = fakeDeps([pc('PCPCPC')])
    const launch = await enterGlobal('Me', deps)
    expect(launch).toMatchObject({ role: 'client', worldKind: 'global', session: { code: 'PCPCPC' } })
    expect(deps.connect).toHaveBeenCalledWith('PCPCPC', 'Me', 'pc')
  })

  test('a paused PC is waited for without a deadline, then joined', async () => {
    const hours = Math.ceil((5 * 3600_000) / PAUSE_POLL_MS)
    const { deps } = fakeDeps([...Array.from({ length: hours }, () => paused), pc('PCPCPC')])
    const launch = await enterGlobal('Me', deps)
    expect(launch).toMatchObject({ role: 'client', session: { code: 'PCPCPC' } })
    expect(deps.sleep).toHaveBeenCalledWith(PAUSE_POLL_MS)
    expect(deps.onStatus).toHaveBeenCalledWith(PAUSED_TEXT)
    expect(deps.now()).toBeGreaterThan(HANDOVER_TIMEOUT_MS * 100)
  })

  test('after a bye from the PC, its room is joined again even though the code is the same', async () => {
    const { deps } = fakeDeps([paused, pc('PCPCPC')])
    const launch = await handover('Me', mine, 'PCPCPC', deps)
    expect(launch).toMatchObject({ role: 'client', session: { code: 'PCPCPC' } })
  })

  describe('awaitHostPc', () => {
    test('polls every 5 s while the PC is paused, and rejoins it when it is back', async () => {
      const { deps } = fakeDeps([paused, paused, pc('PCPCPC')])
      const launch = await awaitHostPc('Me', mine, deps, () => true)
      expect(launch).toMatchObject({ role: 'client', session: { code: 'PCPCPC' } })
      expect(deps.claim).toHaveBeenCalledTimes(3)
      expect(deps.sleep).toHaveBeenCalledTimes(3)
      expect(deps.sleep).toHaveBeenCalledWith(PAUSE_POLL_MS)
    })

    test('a pause the PC lifted over the same link ends the wait with nothing to do', async () => {
      const { deps } = fakeDeps([paused])
      let polls = 0
      const launch = await awaitHostPc('Me', mine, deps, () => ++polls < 3)
      expect(launch).toBeNull()
      expect(deps.connect).not.toHaveBeenCalled()
    })

    test('a PC that the site still counts as online but does not answer is more waiting', async () => {
      const { deps } = fakeDeps([pc('PCPCPC'), pc('PCPCPC'), pc('QRSTUV')])
      deps.connect = vi.fn(async (code: string) => {
        if (code === 'PCPCPC') throw new Error('Could not reach the host (is the game still open?)')
        return { kind: 'client', code } as never
      })
      const launch = await awaitHostPc('Me', mine, deps, () => true)
      // it came back after a restart, under a new code
      expect(launch).toMatchObject({ role: 'client', session: { code: 'QRSTUV' } })
      expect(deps.connect).toHaveBeenCalledTimes(3)
    })

    test('a PC released to the browsers hands us to the queue, our gear carried if we host', async () => {
      const { deps } = fakeDeps([paused, host])
      const launch = await awaitHostPc('Me', mine, deps, () => true)
      expect(launch).toMatchObject({ role: 'host', restore: { players: { '7': mine } } })
    })

    test('the site being unreachable for a while is waited out; a swept seat is taken again', async () => {
      const { deps } = fakeDeps([pc('PCPCPC')])
      let calls = 0
      deps.claim = vi.fn(async () => {
        calls++
        if (calls === 1) throw new ApiError(0, 'Could not reach the server')
        throw new ApiError(404, 'You are not in the global world')
      })
      const launch = await awaitHostPc('Me', mine, deps, () => true)
      expect(launch).toMatchObject({ role: 'client', session: { code: 'PCPCPC' } })
      expect(deps.join).toHaveBeenCalledOnce()
    })
  })
})
