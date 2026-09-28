import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError, type SignalRow } from '../api'
import { POLL_ACTIVE_MS, POLL_ACTIVE_WINDOW_MS, POLL_IDLE_MS, Signaller, type SignalMessage } from '../transport'

// the transport talks to the server only through the api module
const mocks = vi.hoisted(() => ({
  signal: vi.fn<(code: string, msg: unknown) => Promise<void>>(),
  signals: vi.fn<(code: string, to: string, after: number) => Promise<{ signals: SignalRow[] }>>(),
}))
vi.mock('../api', async importOriginal => {
  const real = await importOriginal<typeof import('../api')>()
  return { ...real, api: { ...real.api, signal: mocks.signal, signals: mocks.signals } }
})

const row = (id: number, type: SignalRow['type'] = 'candidate', from = 'clientBBBBBB'): SignalRow =>
  ({ id, from, type, data: { n: id } })

/** run timers and the promise chain of one poll */
const tick = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms) }

describe('Signaller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.signal.mockReset().mockResolvedValue(undefined)
    mocks.signals.mockReset().mockResolvedValue({ signals: [] })
  })
  afterEach(() => { vi.useRealTimers() })

  test('delivers rows addressed to us in server order and advances the cursor', async () => {
    mocks.signals
      .mockResolvedValueOnce({ signals: [row(3, 'offer'), row(4)] })
      .mockResolvedValueOnce({ signals: [row(7)] })
    const got: SignalMessage[] = []
    const s = new Signaller('ABCDEF', 'hostAAAAAAAA')
    s.on(m => got.push(m))
    s.start()

    await tick(0)
    expect(mocks.signals).toHaveBeenLastCalledWith('ABCDEF', 'hostAAAAAAAA', 0)
    expect(got.map(m => m.type)).toEqual(['offer', 'candidate'])
    expect(got[0]).toEqual({ from: 'clientBBBBBB', to: 'hostAAAAAAAA', type: 'offer', data: { n: 3 } })

    await tick(POLL_ACTIVE_MS)
    expect(mocks.signals).toHaveBeenLastCalledWith('ABCDEF', 'hostAAAAAAAA', 4)
    expect(got).toHaveLength(3)

    await tick(POLL_ACTIVE_MS)
    expect(mocks.signals).toHaveBeenLastCalledWith('ABCDEF', 'hostAAAAAAAA', 7)
    s.leave()
  })

  test('polls quickly while a handshake is in flight and relaxes once the room is quiet', async () => {
    let clock = 0
    const s = new Signaller('ABCDEF', 'hostAAAAAAAA', { now: () => clock })
    s.start()
    await tick(0)
    expect(mocks.signals).toHaveBeenCalledTimes(1)

    // nothing has ever arrived: idle cadence
    await tick(POLL_ACTIVE_MS)
    expect(mocks.signals).toHaveBeenCalledTimes(1)
    await tick(POLL_IDLE_MS - POLL_ACTIVE_MS)
    expect(mocks.signals).toHaveBeenCalledTimes(2)

    // a signal lands: the next polls are quick
    mocks.signals.mockResolvedValueOnce({ signals: [row(1, 'offer')] })
    clock = 100_000
    await tick(POLL_IDLE_MS)
    expect(mocks.signals).toHaveBeenCalledTimes(3)
    await tick(POLL_ACTIVE_MS)
    expect(mocks.signals).toHaveBeenCalledTimes(4)

    // the window passes with nothing new: back to idle
    clock += POLL_ACTIVE_WINDOW_MS + 1
    await tick(POLL_ACTIVE_MS)
    expect(mocks.signals).toHaveBeenCalledTimes(5)
    await tick(POLL_ACTIVE_MS)
    expect(mocks.signals).toHaveBeenCalledTimes(5)
    await tick(POLL_IDLE_MS - POLL_ACTIVE_MS)
    expect(mocks.signals).toHaveBeenCalledTimes(6)
    s.leave()
  })

  test('a joining client always polls at the active cadence and stops on leave()', async () => {
    const s = new Signaller('ABCDEF', 'clientBBBBBB', { alwaysActive: true })
    s.start()
    await tick(0)
    await tick(POLL_ACTIVE_MS)
    await tick(POLL_ACTIVE_MS)
    expect(mocks.signals).toHaveBeenCalledTimes(3)
    s.leave()
    await tick(POLL_IDLE_MS * 10)
    expect(mocks.signals).toHaveBeenCalledTimes(3)
    // and it does not come back
    s.start()
    await tick(POLL_IDLE_MS)
    expect(mocks.signals).toHaveBeenCalledTimes(3)
  })

  test('never overlaps polls: a slow response holds the next one', async () => {
    let release!: (v: { signals: SignalRow[] }) => void
    mocks.signals.mockReturnValueOnce(new Promise(r => { release = r }))
    const s = new Signaller('ABCDEF', 'hostAAAAAAAA', { alwaysActive: true })
    s.start()
    await tick(0)
    await tick(POLL_ACTIVE_MS * 5)
    expect(mocks.signals).toHaveBeenCalledTimes(1)
    release({ signals: [] })
    await tick(0)
    await tick(POLL_ACTIVE_MS)
    expect(mocks.signals).toHaveBeenCalledTimes(2)
    s.leave()
  })

  test('backs off on errors and flags a missing room without giving up', async () => {
    mocks.signals.mockRejectedValueOnce(new ApiError(0, 'Could not reach the server'))
    const s = new Signaller('ABCDEF', 'hostAAAAAAAA', { alwaysActive: true })
    s.start()
    await tick(0)
    expect(mocks.signals).toHaveBeenCalledTimes(1)
    // a failure waits longer than the normal cadence
    await tick(POLL_ACTIVE_MS)
    expect(mocks.signals).toHaveBeenCalledTimes(1)
    await tick(1000 - POLL_ACTIVE_MS)
    expect(mocks.signals).toHaveBeenCalledTimes(2)
    expect(s.gone).toBeNull()

    mocks.signals.mockRejectedValueOnce(new ApiError(404, 'No game with that code.'))
    await tick(POLL_ACTIVE_MS)
    expect(mocks.signals).toHaveBeenCalledTimes(3)
    expect(s.gone?.message).toMatch(/no longer open/)
    // still polling, one backoff step later, and a success clears the flag
    await tick(1000)
    expect(mocks.signals).toHaveBeenCalledTimes(4)
    expect(s.gone).toBeNull()
    s.leave()
  })

  test('send() posts to the room mailbox from our id', async () => {
    const s = new Signaller('ABCDEF', 'clientBBBBBB')
    await s.send('hostAAAAAAAA', 'offer', { sdp: 'v=0' })
    expect(mocks.signal).toHaveBeenCalledWith('ABCDEF', { from: 'clientBBBBBB', to: 'hostAAAAAAAA', type: 'offer', data: { sdp: 'v=0' } })
  })

  test('send() retries a 5xx or network failure but not a client error', async () => {
    mocks.signal
      .mockRejectedValueOnce(new ApiError(500, 'database is locked'))
      .mockRejectedValueOnce(new ApiError(0, 'Could not reach the server'))
      .mockResolvedValueOnce(undefined)
    const s = new Signaller('ABCDEF', 'clientBBBBBB')
    const p = s.send('hostAAAAAAAA', 'offer', { sdp: 'v=0' })
    await tick(300)
    await tick(600)
    await expect(p).resolves.toBeUndefined()
    expect(mocks.signal).toHaveBeenCalledTimes(3)

    mocks.signal.mockRejectedValueOnce(new ApiError(404, 'No game with that code.'))
    await expect(s.send('hostAAAAAAAA', 'offer', { sdp: 'v=0' })).rejects.toMatchObject({ status: 404 })
    expect(mocks.signal).toHaveBeenCalledTimes(4)
  })
})
