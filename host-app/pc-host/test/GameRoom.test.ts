import { describe, expect, test } from 'vitest'
import { GameRoom, MAX_TICK_GAP_SECONDS, RETURN_WINDOW_MS, type Peer, type Player, type RoomStore } from '../src/room/GameRoom'
import { HostSim } from '../src/sim/HostSim'
import { DEFAULT_RULES } from '@game/game/rules'
import { decode, encode, PROTOCOL_VERSION, type HostMessage } from '@game/net/protocol'

/** a connection that records what it was sent, and can be made to fail */
function fakePeer(id: string, opts: { failSend?: boolean } = {}) {
  const peer = {
    id,
    received: [] as HostMessage[],
    closed: false,
    send(bytes: Uint8Array) {
      if (opts.failSend) throw new Error('channel gone')
      peer.received.push(decode<HostMessage>(bytes))
    },
    close() {
      peer.closed = true
    },
    last<T extends HostMessage['t']>(t: T): Extract<HostMessage, { t: T }> | undefined {
      return peer.received.filter((m): m is Extract<HostMessage, { t: T }> => m.t === t).at(-1)
    },
  }
  return peer satisfies Peer
}

function fakeStore() {
  const store = {
    saves: 0,
    problems: new Map<number, string>(),
    async saveWorld() { store.saves++ },
    async recordRun() {},
    async accessProblems(players: readonly Player[]) { return players.map(p => store.problems.get(p.userId) ?? null) },
  }
  return store satisfies RoomStore
}

function room() {
  const clock = { now: 0 }
  const store = fakeStore()
  const sim = new HostSim({ seed: 7, rules: DEFAULT_RULES })
  return { room: new GameRoom(sim, store, () => clock.now), sim, store, clock }
}

const ana: Player = { userId: 1, name: 'Ana', deviceId: 10 }
const hello = (name = 'Sam', userId?: number) => encode({ t: 'hello', v: PROTOCOL_VERSION, name, userId })

function join(r: GameRoom, id: string, player: Player = ana) {
  const peer = fakePeer(id)
  r.connect(peer, player)
  r.receive(peer, hello())
  return peer
}

describe('GameRoom', () => {
  test('a player is who the site says, whatever the hello claims', () => {
    const { room: r, sim } = room()
    const peer = fakePeer('p1')
    r.connect(peer, ana)
    r.receive(peer, hello('Mallory', 99))
    expect(peer.last('welcome')).toMatchObject({ t: 'welcome', v: 1, you: 'p1' })
    // v1 has no `look`: today's clients get the welcome they expect
    expect(peer.last('welcome')).not.toHaveProperty('look')
    const avatar = sim.avatars.get('p1')!
    expect(avatar.name).toBe('Ana')
    expect(avatar.userId).toBe(1)
    expect(r.userIds).toEqual([1])
  })

  test('an outdated client is told to reload', () => {
    const { room: r } = room()
    const peer = fakePeer('p1')
    r.connect(peer, ana)
    r.receive(peer, encode({ t: 'hello', v: 2, name: 'Ana' }))
    expect(peer.last('state')?.message).toMatch(/reload/)
    expect(peer.closed).toBe(true)
    expect(r.playerCount).toBe(0)
  })

  test('a second connection of the same account replaces the first', () => {
    const { room: r } = room()
    const first = join(r, 'p1')
    join(r, 'p2')
    expect(first.closed).toBe(true)
    expect(first.last('bye')).toBeDefined()
    expect(r.playerCount).toBe(1)
  })

  test('a message that trips a bug is dropped, and the room carries on', () => {
    const { room: r, sim } = room()
    const peer = join(r, 'p1')
    sim.apply = () => { throw new Error('boom') }
    expect(() => r.receive(peer, encode({ t: 'reload' }))).not.toThrow()
    expect(() => r.tick(1 / 30)).not.toThrow()
    expect(r.playerCount).toBe(1)
  })

  test('a connection that never says hello is dropped after a while', () => {
    const { room: r, clock } = room()
    const silent = fakePeer('p1')
    r.connect(silent, ana)
    clock.now = 11_000
    r.tick(1 / 30)
    expect(silent.closed).toBe(true)
  })

  test('closing still finishes when a channel fails, saves, and nothing feeds the room afterwards', async () => {
    const { room: r, store } = room()
    const broken = fakePeer('p1', { failSend: true })
    r.connect(broken, ana)
    await r.close('bye')
    expect(r.isClosed).toBe(true)
    expect(store.saves).toBe(1)
    r.receive(broken, hello())
    expect(r.playerCount).toBe(0)
  })
})

describe('GameRoom pause and reconnect', () => {
  test('a frozen world does not move: no ticks, no snapshots, no actions', () => {
    const { room: r, sim } = room()
    const peer = join(r, 'p1')
    for (let i = 0; i < 10; i++) r.tick(1 / 30)
    const time = sim.dayNight.time
    const snaps = peer.received.filter(m => m.t === 'snap').length
    expect(snaps).toBeGreaterThan(0)

    r.freeze()
    for (let i = 0; i < 300; i++) r.tick(1 / 30)
    expect(sim.dayNight.time).toBe(time)
    expect(peer.received.filter(m => m.t === 'snap').length).toBe(snaps)
    const a = sim.avatars.get('p1')!
    a.inventory.add('dirt', 1)
    const before = a.inventory.count('dirt')
    r.receive(peer, encode({ t: 'dropHeld', slot: a.inventory.all().findIndex(s => s?.id === 'dirt'), dx: 1, dz: 0 }))
    expect(a.inventory.count('dirt')).toBe(before)

    r.resume()
    r.tick(1 / 30)
    expect(sim.dayNight.time).toBeGreaterThan(time)
  })

  test('a player who drops out gets their spot and state back when they reconnect', () => {
    const { room: r, sim } = room()
    join(r, 'p1')
    const a = sim.avatars.get('p1')!
    a.x += 3
    a.inventory.add('log', 4)
    a.health = 55
    const spot = { x: a.x, z: a.z }

    r.freeze()
    r.disconnect({ id: 'p1', send: () => {}, close: () => {} })
    expect(r.playerCount).toBe(0)
    expect(r.heldUserIds).toEqual([1])

    // hours later the PC is back and the player reconnects
    r.resume()
    const again = join(r, 'p9')
    const b = sim.avatars.get('p9')!
    expect(b.x).toBeCloseTo(spot.x)
    expect(b.z).toBeCloseTo(spot.z)
    expect(b.health).toBe(55)
    expect(b.inventory.count('log')).toBe(4)
    expect(again.last('welcome')?.spawn.x).toBeCloseTo(spot.x)
    expect(r.heldUserIds).toEqual([])
  })

  test('a place is kept for the whole pause, then for the return window after it', () => {
    const { room: r, sim, clock } = room()
    join(r, 'p1')
    sim.avatars.get('p1')!.x += 3
    r.freeze()
    r.disconnect({ id: 'p1', send: () => {}, close: () => {} })

    clock.now += 6 * 3600_000
    r.tick(1 / 30)
    expect(r.heldUserIds).toEqual([1])

    r.resume()
    clock.now += RETURN_WINDOW_MS - 1000
    r.tick(1 / 30)
    expect(r.heldUserIds).toEqual([1])
    clock.now += 2000
    r.tick(1 / 30)
    // they gave up: saved and dropped like any leave, back at their spawn next time
    expect(r.heldUserIds).toEqual([])
    join(r, 'p2')
    const b = sim.avatars.get('p2')!
    expect(b.x).toBe(b.spawn.x)
  })

  test('a long gap between ticks (the PC slept) is discarded, not simulated', () => {
    const { room: r, sim } = room()
    join(r, 'p1')
    r.tick(1 / 30)
    const gaps: number[] = []
    r.onGap = s => gaps.push(s)
    const time = sim.dayNight.time
    r.tick(MAX_TICK_GAP_SECONDS + 3600)
    expect(gaps).toEqual([MAX_TICK_GAP_SECONDS + 3600])
    expect(sim.dayNight.time).toBe(time)
  })

  test('a player whose access ended is sent off and their place is not kept', async () => {
    const { room: r, store } = room()
    const peer = join(r, 'p1')
    store.problems.set(1, 'This account has been disabled.')
    await r.checkAccess()
    expect(peer.last('state')?.message).toBe('This account has been disabled.')
    expect(peer.closed).toBe(true)
    expect(r.playerCount).toBe(0)
    expect(r.heldUserIds).toEqual([])
  })

  test('a reset sends everyone off and starts a fresh world that is saved', async () => {
    const { room: r, store } = room()
    const peer = join(r, 'p1')
    r.reset(new HostSim({ seed: 7, rules: DEFAULT_RULES }), 'The global world was reset.')
    expect(peer.last('state')?.message).toBe('The global world was reset.')
    expect(r.playerCount).toBe(0)
    await r.saveNow()
    expect(store.saves).toBe(1)
  })
})
