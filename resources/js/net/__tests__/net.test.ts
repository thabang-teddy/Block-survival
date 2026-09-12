import { describe, expect, test } from 'vitest'
import { decode, encode, isRoomCode, makeRoomCode, normalizeRoomCode, peerIdForRoom, type Snapshot, type ClientMessage } from '../protocol'
import { SnapshotBuffer } from '../SnapshotBuffer'

const snap = (time: number, x: number, yaw = 0): Snapshot => ({
  t: 'snap', time,
  players: [{ id: 'p1', name: 'A', x, y: 1, z: 0, yaw, pitch: 0, anim: 'Walk', held: null, health: 100, dead: false, kills: 0, deaths: 0 }],
  zombies: [{ id: 7, kind: 'Basic', x: x * 2, y: 1, z: 0, yaw: 0, state: 'chase', attacked: false, burnTimer: 0 }],
  drops: [{ id: 3, item: 'dirt', x, y: 1, z: 0 }],
  crates: [],
})

describe('protocol', () => {
  test('messages survive a pack/unpack round trip', () => {
    const msg: ClientMessage = { t: 'place', x: 1, y: 2, z: -3, nx: 0, ny: 1, nz: 0, slot: 4, yaw: Math.PI / 2 }
    expect(decode(encode(msg))).toEqual(msg)
    const s = snap(12.5, 3, 1.25)
    expect(decode(encode(s))).toEqual(s)
    expect(decode(encode(s).buffer as ArrayBuffer)).toEqual(s) // ArrayBuffer input, as PeerJS delivers it
  })

  test('room codes are 6 unambiguous letters and normalise user input', () => {
    const code = makeRoomCode(() => 0.5)
    expect(code).toHaveLength(6)
    expect(isRoomCode(code)).toBe(true)
    expect(normalizeRoomCode(' ab-cd ef ')).toBe('ABCDEF')
    expect(isRoomCode('ABCDEI')).toBe(false) // I is excluded
    expect(isRoomCode('ABC')).toBe(false)
    expect(peerIdForRoom('ABCDEF')).toBe('block-survival-ABCDEF')
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) seen.add(makeRoomCode())
    expect(seen.size).toBeGreaterThan(190)
  })
})

describe('SnapshotBuffer', () => {
  test('blends the two snapshots bracketing (host time - delay)', () => {
    const b = new SnapshotBuffer()
    b.push(snap(10.0, 0), 100.0)
    b.push(snap(10.05, 1), 100.05)
    b.push(snap(10.1, 2), 100.1)
    // now = 100.1 local → host time 10.1 → render at 10.0: exactly the first snapshot
    expect(b.sample(100.1)!.players[0].x).toBeCloseTo(0)
    // 25 ms later → render at 10.025: halfway between the first two
    const mid = b.sample(100.125)!
    expect(mid.players[0].x).toBeCloseTo(0.5)
    expect(mid.zombies[0].x).toBeCloseTo(1)
    expect(mid.drops[0].x).toBeCloseTo(0.5)
  })

  test('angles blend along the shortest arc and new entities appear without a partner', () => {
    const b = new SnapshotBuffer()
    b.push(snap(10.0, 0, Math.PI - 0.1), 100.0)
    const second = snap(10.1, 1, -Math.PI + 0.1)
    second.players.push({ ...second.players[0], id: 'p2', x: 9 })
    b.push(second, 100.1)
    const s = b.sample(100.15)! // render at 10.05: halfway
    const yaw = s.players[0].yaw
    expect(Math.abs(Math.abs(yaw) - Math.PI)).toBeLessThan(0.02) // wrapped through ±π, not through 0
    expect(s.players).toHaveLength(2)
    expect(s.players[1].x).toBe(9)
  })

  test('entities missing from the newer snapshot are gone; a single snapshot renders as-is', () => {
    const b = new SnapshotBuffer()
    expect(b.sample(1)).toBeNull()
    b.push(snap(5, 4), 50)
    expect(b.sample(50.2)!.players[0].x).toBe(4)
    const later = snap(5.1, 5)
    later.zombies = []
    b.push(later, 50.1)
    expect(b.sample(50.3)!.zombies).toHaveLength(0)
    expect(b.hostTime(50.6)).toBeCloseTo(5.6)
  })
})
