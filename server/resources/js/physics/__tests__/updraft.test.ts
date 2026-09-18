import { describe, expect, test } from 'vitest'
import { World } from '../../world/chunkStore'
import { BLOCK } from '../../world/palette'
import { UPDRAFT, type Updraft } from '../../world/updraft'
import { PlayerController, PLAYER } from '../playerController'
import type { Input } from '../../input/Input'

/** flat 41×41 floor of stone at y = 0 */
function floorWorld(): World {
  const w = new World()
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) w.setBlock(x, 0, z, BLOCK.stone)
  return w
}

const fakeInput = (down: string[] = []): Input =>
  ({ isDown: (code: string) => down.includes(code), locked: true }) as unknown as Input

const SHAFT: Updraft = { x: 0.5, z: 0.5, bottomY: 1, topY: 40, radius: 1.25, ix: 0, iz: 0 }

function inShaft(y = 10): PlayerController {
  const p = new PlayerController(floorWorld(), { x: 0.5, y, z: 0.5 })
  p.updrafts = () => [SHAFT]
  return p
}

const DT = 1 / 60

describe('updraft physics', () => {
  test('holding Space rises at the shaft speed after easing in', () => {
    const p = inShaft()
    for (let i = 0; i < 30; i++) p.update(DT, fakeInput(['Space']))
    expect(p.state.inUpdraft).toBe(true)
    expect(p.state.vy).toBeCloseTo(UPDRAFT.rise, 3)
    expect(p.state.y).toBeGreaterThan(11)
  })

  test('no key hovers: the player neither falls nor rises', () => {
    const p = inShaft()
    for (let i = 0; i < 30; i++) p.update(DT, fakeInput())
    expect(Math.abs(p.state.vy)).toBeLessThan(0.05)
    expect(p.state.y).toBeCloseTo(10, 1)
    expect(p.state.onGround).toBe(false)
  })

  test('holding Shift sinks, and the floor still stops you', () => {
    const p = inShaft(6)
    for (let i = 0; i < 20; i++) p.update(DT, fakeInput(['ShiftLeft']))
    expect(p.state.vy).toBeCloseTo(-UPDRAFT.sink, 3)
    for (let i = 0; i < 200; i++) p.update(DT, fakeInput(['ShiftLeft']))
    expect(p.state.y).toBeCloseTo(1, 2)
    expect(p.state.onGround).toBe(true)
  })

  test('the lift stops at the top of the shaft', () => {
    const p = inShaft(38)
    for (let i = 0; i < 120; i++) p.update(DT, fakeInput(['Space']))
    expect(p.state.y).toBeLessThanOrEqual(SHAFT.topY + 0.2)
    expect(p.state.y).toBeGreaterThanOrEqual(SHAFT.topY - 0.2)
  })

  test('gravity resumes one step outside the radius', () => {
    const p = new PlayerController(floorWorld(), { x: 0.5 + SHAFT.radius + 0.05, y: 10, z: 0.5 })
    p.updrafts = () => [SHAFT]
    for (let i = 0; i < 30; i++) p.update(DT, fakeInput(['Space']))
    expect(p.state.inUpdraft).toBe(false)
    expect(p.state.vy).toBeLessThan(0)
    expect(p.state.y).toBeLessThan(10)
  })

  test('a jump inside the shaft does not launch the player', () => {
    const p = inShaft(2)
    p.queueJump()
    p.update(DT, fakeInput())
    expect(p.state.vy).toBeLessThan(1)
    expect(p.state.vy).toBeLessThan(PLAYER.jumpSpeed / 2)
  })

  test('a dead (frozen) player is not carried', () => {
    const p = inShaft()
    for (let i = 0; i < 30; i++) p.update(DT, fakeInput(['Space']), true)
    expect(p.state.inUpdraft).toBe(false)
    expect(p.state.y).toBeLessThan(10)
  })

  test('the shaft is only a lift: walking out of it at height drops you', () => {
    const p = inShaft(20)
    for (let i = 0; i < 60; i++) p.update(DT, fakeInput(['KeyD']))
    expect(p.state.inUpdraft).toBe(false)
    expect(p.state.vy).toBeLessThan(0)
  })
})
