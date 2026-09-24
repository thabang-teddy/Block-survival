import { test } from '@japa/runner'
import { GameRoom, type Peer, type RoomStore } from '#game-server/game_room'
import { HostSim } from '#game/sim/HostSim'
import { DEFAULT_RULES } from '#game/game/rules'
import { encode, PROTOCOL_VERSION } from '#game/net/protocol'

/** a socket that records what it was sent, and can be made to fail */
function fakePeer(id: string, opts: { failSend?: boolean } = {}) {
  const peer = {
    id,
    sent: 0,
    closed: false,
    send() {
      if (opts.failSend) throw new Error('socket gone')
      peer.sent++
    },
    close() {
      peer.closed = true
    },
  }
  return peer satisfies Peer
}

function fakeStore() {
  const store = {
    saves: 0,
    rowRemoved: false,
    async saveWorld() {
      store.saves++
    },
    async recordRun() {},
    async refreshRow() {},
    async removeRow() {
      store.rowRemoved = true
    },
    async accessProblem() {
      return null
    },
  }
  return store satisfies RoomStore
}

function room(now: () => number = Date.now) {
  const store = fakeStore()
  const sim = new HostSim({ seed: 7, rules: DEFAULT_RULES })
  return { room: new GameRoom('ABCDEF', 'own', 1, sim, store, now), sim, store }
}

const hello = encode({ t: 'hello', v: PROTOCOL_VERSION, name: 'Sam' })

test.group('GameRoom', () => {
  test('a message that trips a bug is dropped, and the room carries on', ({ assert }) => {
    const { room: r, sim } = room()
    const peer = fakePeer('p1')
    r.connect(peer, { userId: 1, name: 'Sam', deviceId: null })
    r.receive(peer, hello)
    sim.apply = () => {
      throw new Error('boom')
    }
    assert.doesNotThrow(() => r.receive(peer, encode({ t: 'reload' })))
    assert.doesNotThrow(() => r.tick(1 / 30))
    assert.equal(r.playerCount, 1)
  })

  test('a socket that never says hello is dropped after a while', ({ assert }) => {
    let now = 0
    const { room: r } = room(() => now)
    const silent = fakePeer('p1')
    r.connect(silent, { userId: 1, name: 'Sam', deviceId: null })
    now = 11_000
    r.tick(1 / 30)
    assert.isTrue(silent.closed)
  })

  test('closing still finishes when a socket fails, and nothing feeds the room afterwards', async ({ assert }) => {
    const { room: r, store } = room()
    const broken = fakePeer('p1', { failSend: true })
    r.connect(broken, { userId: 1, name: 'Sam', deviceId: null })
    await r.close('bye')
    assert.isTrue(r.isClosed)
    assert.isTrue(store.rowRemoved)
    assert.equal(store.saves, 1)
    r.receive(broken, hello)
    assert.equal(r.playerCount, 0)
  })
})
