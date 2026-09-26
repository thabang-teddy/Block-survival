import { describe, expect, test, vi } from 'vitest'
import { ApiError, type GlobalState } from '../api'
import { awaitHostPc, enterGlobal, PAUSE_POLL_MS, PAUSED_TEXT, reconnectGlobal, rejoinRoom, WorldOfflineError, type GlobalWorldDeps } from '../globalWorld'

const WORLD = 3
const room = (code: string) => ({ code, host_peer_id: `peer-${code}`, host_name: 'HomePC', world_kind: 'global' as const, players: 1, expires_at: '' })
const pc = (code: string): GlobalState => ({ status: 'client', host: 'pc', world: WORLD, host_name: 'HomePC', room: room(code), online: 2 })
const paused: GlobalState = { status: 'paused', host: 'pc', world: WORLD, host_name: 'HomePC', online: 2 }
const offline: GlobalState = { status: 'offline', host: 'pc', message: "This world is offline — its host PC isn't running." }

type Answer = GlobalState | ApiError

/** a fake of everything the flow touches; `answers` are the server's, in order (the last one repeats) */
function fakeDeps(answers: Answer[]) {
  const queue = [...answers]
  const next = () => {
    const a = queue.length > 1 ? queue.shift()! : queue[0]
    return a instanceof ApiError ? Promise.reject(a) : Promise.resolve(a)
  }
  const deps: GlobalWorldDeps = {
    join: vi.fn(next),
    claim: vi.fn(next),
    connect: vi.fn(async (code: string) => ({ kind: 'client', code }) as never),
    sleep: vi.fn(async () => {}),
    onStatus: vi.fn(),
  }
  return deps
}

describe('enterGlobal', () => {
  test('joins the world picked in the lobby, as a PC-hosted session', async () => {
    const deps = fakeDeps([pc('PCPCPC')])
    const launch = await enterGlobal(WORLD, 'Me', deps)
    expect(deps.join).toHaveBeenCalledWith(WORLD)
    expect(deps.connect).toHaveBeenCalledWith('PCPCPC', 'Me', 'pc')
    expect(launch).toMatchObject({ role: 'client', worldKind: 'global', globalWorld: WORLD, session: { code: 'PCPCPC' } })
    expect(deps.claim).not.toHaveBeenCalled()
  })

  test('a paused PC is waited for without a deadline, then joined', async () => {
    const deps = fakeDeps([paused, ...Array(50).fill(paused), pc('PCPCPC')])
    const launch = await enterGlobal(WORLD, 'Me', deps)
    expect(launch).toMatchObject({ role: 'client', session: { code: 'PCPCPC' } })
    expect(deps.claim).toHaveBeenCalledTimes(51)
    expect(deps.sleep).toHaveBeenCalledWith(PAUSE_POLL_MS)
    expect(deps.onStatus).toHaveBeenCalledWith(PAUSED_TEXT)
  })

  test('a world that closes while we wait sends us back with its message', async () => {
    const deps = fakeDeps([paused, offline])
    await expect(enterGlobal(WORLD, 'Me', deps)).rejects.toThrow(WorldOfflineError)
    expect(deps.connect).not.toHaveBeenCalled()
  })

  test('a refusal from the server is the error the lobby shows', async () => {
    const deps = fakeDeps([new ApiError(409, "This world is offline — its host PC isn't running.")])
    await expect(enterGlobal(WORLD, 'Me', deps)).rejects.toThrow("This world is offline — its host PC isn't running.")
  })
})

describe('reconnectGlobal', () => {
  test('a seat still held goes back into the same room', async () => {
    const deps = fakeDeps([pc('PCPCPC')])
    const launch = await reconnectGlobal(WORLD, 'Me', deps)
    expect(deps.claim).toHaveBeenCalledOnce()
    expect(deps.join).not.toHaveBeenCalled()
    expect(launch).toMatchObject({ role: 'client', globalWorld: WORLD, session: { code: 'PCPCPC' } })
  })

  test('a seat swept while the tab was away is taken again in the same world', async () => {
    const deps = fakeDeps([new ApiError(404, 'You are not in a global world'), pc('PCPCPC')])
    await reconnectGlobal(WORLD, 'Me', deps)
    expect(deps.join).toHaveBeenCalledWith(WORLD)
  })

  test('any other refusal is the error the overlay shows', async () => {
    const deps = fakeDeps([new ApiError(500, 'Server error')])
    await expect(reconnectGlobal(WORLD, 'Me', deps)).rejects.toThrow('Server error')
    expect(deps.join).not.toHaveBeenCalled()
  })
})

describe('rejoinRoom', () => {
  test('dials the same room again and keeps the kind of world it was', async () => {
    const deps = fakeDeps([pc('PCPCPC')])
    const launch = await rejoinRoom('ABCDEF', 'Me', 'own', deps)
    expect(deps.connect).toHaveBeenCalledWith('ABCDEF', 'Me', 'browser')
    expect(launch).toEqual({ role: 'client', name: 'Me', session: { kind: 'client', code: 'ABCDEF' }, worldKind: 'own' })
  })
})

describe('awaitHostPc', () => {
  test('polls every 5 s while the PC is paused, and rejoins it when it is back', async () => {
    const deps = fakeDeps([paused, paused, pc('PCPCPC')])
    const launch = await awaitHostPc(WORLD, 'Me', deps, () => true)
    expect(deps.claim).toHaveBeenCalledTimes(3)
    expect(deps.sleep).toHaveBeenCalledTimes(3)
    expect(deps.sleep).toHaveBeenCalledWith(PAUSE_POLL_MS)
    expect(launch).toMatchObject({ role: 'client', globalWorld: WORLD, session: { code: 'PCPCPC' } })
  })

  test('a pause the PC lifted over the same link ends the wait with nothing to do', async () => {
    const deps = fakeDeps([paused])
    let polls = 0
    const launch = await awaitHostPc(WORLD, 'Me', deps, () => ++polls < 2)
    expect(launch).toBeNull()
    expect(deps.connect).not.toHaveBeenCalled()
  })

  test('a PC that the site still counts as online but does not answer is more waiting', async () => {
    const deps = fakeDeps([pc('PCPCPC'), pc('PCPCPC')])
    let tries = 0
    deps.connect = vi.fn(async (code: string) => {
      if (++tries === 1) throw new Error('no welcome')
      return { kind: 'client', code } as never
    })
    const launch = await awaitHostPc(WORLD, 'Me', deps, () => true)
    expect(deps.connect).toHaveBeenCalledTimes(2)
    expect(launch).toMatchObject({ session: { code: 'PCPCPC' } })
  })

  test('the site being unreachable for a while is waited out', async () => {
    const deps = fakeDeps([new ApiError(0, 'offline'), new ApiError(502, 'bad gateway'), pc('PCPCPC')])
    const launch = await awaitHostPc(WORLD, 'Me', deps, () => true)
    expect(launch).toMatchObject({ session: { code: 'PCPCPC' } })
  })

  test('a world marked offline while we wait ends the wait with its message', async () => {
    const deps = fakeDeps([paused, offline])
    await expect(awaitHostPc(WORLD, 'Me', deps, () => true)).rejects.toThrow("This world is offline — its host PC isn't running.")
  })

  test('a swept seat is taken again, and a world closed meanwhile is reported as offline', async () => {
    const deps = fakeDeps([new ApiError(404, 'not seated'), pc('PCPCPC')])
    await expect(awaitHostPc(WORLD, 'Me', deps, () => true)).resolves.toMatchObject({ session: { code: 'PCPCPC' } })
    expect(deps.join).toHaveBeenCalledWith(WORLD)

    const closed = fakeDeps([new ApiError(404, 'not seated'), new ApiError(409, 'This world is offline.')])
    await expect(awaitHostPc(WORLD, 'Me', closed, () => true)).rejects.toThrow(WorldOfflineError)
  })
})
