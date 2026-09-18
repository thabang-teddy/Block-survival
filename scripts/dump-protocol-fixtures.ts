/**
 * Wire-protocol fixtures for the native client (docs/flutter-client-plan.md §2 S4).
 *
 * Every message shape in resources/js/net/protocol.ts, encoded with msgpackr exactly
 * as the browser client puts it on the DataChannel, is written to
 * shared/fixtures/protocol/messages.json as { name, message, base64 }. The Dart codec
 * must decode each to an equal value and re-encode it to the same bytes.
 *
 * Regenerate with `npm run fixtures:protocol` whenever protocol.ts changes.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  encode, PROTOCOL_VERSION, INPUT_HZ, SNAPSHOT_HZ, INTERPOLATION_DELAY, MAX_PLAYERS, ROOM_CODE_LENGTH,
  type ClientMessage, type HostMessage,
} from '../resources/js/net/protocol'

const OUT = resolve(import.meta.dirname, '../../shared/fixtures/protocol')

const client: Record<string, ClientMessage> = {
  hello: { t: 'hello', v: PROTOCOL_VERSION, name: 'Teddy', userId: 7 },
  helloGuest: { t: 'hello', v: PROTOCOL_VERSION, name: 'Guest' },
  input: { t: 'input', x: 0.5, y: 37, z: -12.25, yaw: 1.5707963267948966, pitch: -0.1, anim: 'Run', slot: 3, aiming: false },
  inputAiming: { t: 'input', x: -100.125, y: 80, z: 3, yaw: 0, pitch: 0.75, anim: 'Aim', slot: 0, aiming: true },
  break: { t: 'break', x: 10, y: 36, z: -4 },
  place: { t: 'place', x: 10, y: 36, z: -4, nx: 0, ny: 1, nz: 0, slot: 2, yaw: 3 },
  craft: { t: 'craft', recipe: 'planks' },
  moveSlot: { t: 'moveSlot', from: 0, to: 8 },
  dropHeld: { t: 'dropHeld', slot: 1, dx: 0.7071067811865476, dz: -0.7071067811865476 },
  interact: { t: 'interact', x: 1, y: 2, z: 3, block: 16, crate: null },
  interactCrate: { t: 'interact', x: 1, y: 2, z: 3, block: 0, crate: 42 },
  swing: { t: 'swing', ox: 0.5, oy: 38.6, oz: 0.5, dx: 0, dy: -0.2, dz: -0.9797958971132712 },
  fire: { t: 'fire', ox: 0.5, oy: 38.6, oz: 0.5, dx: 1, dy: 0, dz: 0 },
  reload: { t: 'reload' },
  chat: { t: 'chat', text: 'héllo — ünïcode ✓' },
}

const host: Record<string, HostMessage> = {
  welcome: {
    t: 'welcome', v: PROTOCOL_VERSION, you: 'abcDEF123', seed: 11, time: 123.5,
    edits: [
      { x: 1, y: 37, z: 1, id: 8 },
      { x: 2, y: 37, z: 1, id: 0 },
      { x: 3, y: 37, z: 1, id: 15, meta: { id: 15, x: 3, y: 37, z: 1, yaw: 1, primary: true } },
      { x: 4, y: 37, z: 1, id: 17, meta: { id: 17, x: 4, y: 37, z: 1, yaw: 2, partner: { x: 4, y: 37, z: 2 }, primary: true } },
    ],
    spawn: { x: 0.5, y: 37, z: 0.5 },
  },
  snap: {
    t: 'snap', time: 456.75,
    players: [
      { id: 'abcDEF123', name: 'Teddy', x: 0.5, y: 37, z: 0.5, yaw: 0, pitch: 0, anim: 'Idle', held: 'pickaxe', health: 20, dead: false, kills: 3, deaths: 1 },
      { id: 'zzz', name: 'Kiddo', x: -3, y: 38, z: 2.5, yaw: 3.1, pitch: -0.4, anim: 'Walk', held: null, health: 0, dead: true, kills: 0, deaths: 2 },
    ],
    zombies: [
      { id: 1, kind: 'Basic', x: 10, y: 36, z: 10, yaw: 1, state: 'chase', attacked: false, burnTimer: 0 },
      { id: 2, kind: 'Toxic', x: 12, y: 36, z: 9, yaw: 2, state: 'burn', attacked: true, burnTimer: 1.25 },
    ],
    drops: [{ id: 5, item: 'log', x: 1.5, y: 37.5, z: 1.5 }],
    crates: [{ id: 9, x: -3, y: 38, z: 2, items: 4 }],
  },
  snapEmpty: { t: 'snap', time: 0, players: [], zombies: [], drops: [], crates: [] },
  state: {
    t: 'state',
    inventory: [{ id: 'log', count: 12 }, null, { id: 'rifle', count: 1 }],
    magazine: 6, reloading: false, health: 17, poisoned: true, hurtAt: 12.5, dead: false, respawnIn: 0,
    message: 'You feel sick.',
    fx: [{ kind: 'tracer', ax: 0, ay: 1, az: 2, bx: 3, by: 4, bz: 5 }, { kind: 'flash', ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0 }],
  },
  stateTeleport: { t: 'state', teleport: { x: 0.5, y: 37, z: 0.5 }, spawn: { x: 0.5, y: 37, z: 0.5 }, dead: true, respawnIn: 5 },
  blocks: { t: 'blocks', edits: [{ x: 1, y: 2, z: 3, id: 4 }] },
  chat: { t: 'chat', from: 'Teddy', text: 'gg' },
  full: { t: 'full' },
  bye: { t: 'bye' },
}

function main(): void {
  mkdirSync(OUT, { recursive: true })
  const messages = [
    ...Object.entries(client).map(([name, message]) => ({ side: 'client', name, message, base64: Buffer.from(encode(message)).toString('base64') })),
    ...Object.entries(host).map(([name, message]) => ({ side: 'host', name, message, base64: Buffer.from(encode(message)).toString('base64') })),
  ]
  writeFileSync(resolve(OUT, 'messages.json'), JSON.stringify({
    version: PROTOCOL_VERSION,
    constants: { INPUT_HZ, SNAPSHOT_HZ, INTERPOLATION_DELAY, MAX_PLAYERS, ROOM_CODE_LENGTH },
    encoding: 'msgpackr pack() with default options: standard MessagePack, maps with string keys, integral numbers as ints, others as float64',
    generator: 'server/scripts/dump-protocol-fixtures.ts',
    messages,
  }, null, 1) + '\n')
  console.log(`wrote ${messages.length} protocol fixtures to ${OUT}`)
}

main()
