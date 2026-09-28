import { describe, expect, test } from 'vitest'
import { ClientSession, PAUSE_AFTER_SILENCE_SECONDS, type ClientStatus } from '../ClientSession'
import { encode, PROTOCOL_VERSION, type HostMessage } from '../protocol'
import type { Game } from '../../game/Game'
import type { Link } from '../transport'

/** a session with a link and a game attached, driven by hand (no WebRTC) */
function session(hostKind: 'pc' | 'browser') {
  const clock = { now: 100 }
  const s = new ClientSession('PCPCPC', 'Ana', hostKind, () => clock.now)
  const sent: Uint8Array[] = []
  const link: Link = { id: 'host', send: b => sent.push(b), close: () => {} }
  const statuses: ClientStatus[] = []
  s.onStatus = st => statuses.push(st)
  const internals = s as unknown as { link: Link | null; onData(b: Uint8Array): void; onClose(): void }
  internals.link = link
  const game = { local: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, anim: 'Idle', slot: 0, aiming: false }, applyPrivateState() {}, applyBlockEdits() {}, showMessage() {} }
  s.attach(game as unknown as Game)
  const hear = (msg: HostMessage) => internals.onData(encode(msg))
  hear({ t: 'welcome', v: PROTOCOL_VERSION, you: 'me', seed: 1, time: 0, edits: [], spawn: { x: 0, y: 0, z: 0 } })
  const snap = () => hear({ t: 'snap', time: clock.now, players: [], zombies: [], drops: [], crates: [] })
  return { s, clock, sent, statuses, snap, internals }
}

describe('ClientSession pauses (docs/pc-host-research.md §5.4)', () => {
  test('a silent host PC pauses the game, nothing is sent, and snapshots over the same link lift it', () => {
    const { s, clock, sent, statuses, snap } = session('pc')
    snap()
    s.tick(1)
    expect(sent.length).toBe(1)
    clock.now += PAUSE_AFTER_SILENCE_SECONDS + 0.1
    s.tick(1)
    expect(s.status).toBe('paused')
    expect(s.paused).toBe(true)
    s.tick(1)
    expect(sent.length).toBe(1)

    snap()
    expect(s.status).toBe('joined')
    s.tick(1)
    expect(sent.length).toBe(2)
    expect(statuses).toEqual(['joined', 'paused', 'joined'])
  })

  test('the PC\'s link dropping is a pause, not the end of the match', () => {
    const { s, internals, snap } = session('pc')
    internals.onClose()
    expect(s.status).toBe('paused')
    // a stray late snapshot cannot un-pause a session whose link is gone
    snap()
    expect(s.status).toBe('paused')
  })

  test('a browser host is unchanged: silence is not a pause, and a dropped link ends the match', () => {
    const { s, clock, internals } = session('browser')
    clock.now += 60
    s.tick(1)
    expect(s.status).toBe('joined')
    internals.onClose()
    expect(s.status).toBe('host-left')
  })
})
