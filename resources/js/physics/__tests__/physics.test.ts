import { describe, expect, test } from 'vitest'
import { World } from '../../world/chunkStore'
import { BLOCK } from '../../world/palette'
import { boxIntersectsSolid, moveBox, type Box } from '../aabb'
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

describe('aabb', () => {
  test('falling box lands exactly on the floor', () => {
    const w = floorWorld()
    const box: Box = { x: -0.3, y: 3, z: -0.3, w: 0.6, h: 1.8, d: 0.6 }
    const r = moveBox(w, box, 0, -5, 0)
    expect(r.hitY).toBe(true)
    expect(r.box.y).toBeCloseTo(1, 3)
    expect(boxIntersectsSolid(w, r.box)).toBe(false)
  })

  test('horizontal move stops at a wall and keeps the other axis', () => {
    const w = floorWorld()
    w.setBlock(2, 1, 0, BLOCK.stone)
    const box: Box = { x: -0.3, y: 1, z: -0.3, w: 0.6, h: 1.8, d: 0.6 }
    const r = moveBox(w, box, 5, 0, 0.5)
    expect(r.hitX).toBe(true)
    expect(r.hitZ).toBe(false)
    expect(r.box.x + r.box.w).toBeCloseTo(2, 3)
    expect(r.box.z).toBeCloseTo(0.2, 6)
  })

  test('water is not solid', () => {
    const w = new World()
    w.setBlock(0, 0, 0, BLOCK.water)
    expect(boxIntersectsSolid(w, { x: 0.2, y: 0.2, z: 0.2, w: 0.5, h: 0.5, d: 0.5 })).toBe(false)
  })
})

describe('playerController', () => {
  test('gravity pulls the player onto the ground and sets onGround', () => {
    const w = floorWorld()
    const p = new PlayerController(w, { x: 0.5, y: 3, z: 0.5 })
    for (let i = 0; i < 120; i++) p.update(1 / 60, fakeInput())
    expect(p.state.y).toBeCloseTo(1, 2)
    expect(p.state.onGround).toBe(true)
    expect(p.state.vy).toBe(0)
  })

  test('W walks forward along -Z at walk speed; Shift sprints', () => {
    const w = floorWorld()
    const p = new PlayerController(w, { x: 0.5, y: 1, z: 0.5 })
    for (let i = 0; i < 60; i++) p.update(1 / 60, fakeInput(['KeyW']))
    expect(p.state.z).toBeLessThan(0.5 - 3.5)
    expect(Math.hypot(p.state.vx, p.state.vz)).toBeCloseTo(PLAYER.walkSpeed, 1)
    for (let i = 0; i < 60; i++) p.update(1 / 60, fakeInput(['KeyW', 'ShiftLeft']))
    expect(Math.hypot(p.state.vx, p.state.vz)).toBeCloseTo(PLAYER.sprintSpeed, 1)
  })

  test('jump only fires when grounded and reaches about 1.2 m', () => {
    const w = floorWorld()
    const p = new PlayerController(w, { x: 0.5, y: 1, z: 0.5 })
    p.update(1 / 60, fakeInput())
    p.queueJump()
    let peak = 0
    for (let i = 0; i < 90; i++) {
      p.update(1 / 60, fakeInput())
      peak = Math.max(peak, p.state.y)
      if (i === 10) p.queueJump() // mid-air jump must be ignored
    }
    expect(peak - 1).toBeGreaterThan(1.05)
    expect(peak - 1).toBeLessThan(1.4)
    expect(p.state.onGround).toBe(true)
  })

  test('pitch is clamped and yaw wraps freely', () => {
    const p = new PlayerController(floorWorld(), { x: 0, y: 1, z: 0 })
    p.look(0, -100000)
    expect(p.state.pitch).toBeCloseTo(Math.PI / 2 - 0.01)
    p.look(100000, 0)
    expect(Number.isFinite(p.state.yaw)).toBe(true)
  })

  test('overlapsVoxel detects the voxel the player is standing in', () => {
    const p = new PlayerController(floorWorld(), { x: 0.5, y: 1, z: 0.5 })
    expect(p.overlapsVoxel(0, 1, 0)).toBe(true)
    expect(p.overlapsVoxel(0, 2, 0)).toBe(true)
    expect(p.overlapsVoxel(0, 3, 0)).toBe(false)
    expect(p.overlapsVoxel(2, 1, 0)).toBe(false)
  })

  test('sprinting drains stamina, stops at zero, and regenerates after a pause', () => {
    const w = floorWorld()
    const p = new PlayerController(w, { x: 0.5, y: 1, z: 0.5 })
    p.update(1 / 60, fakeInput())
    // sprint back and forth so we stay on the test floor
    for (let i = 0; i < 60 * 7; i++) p.update(1 / 60, fakeInput([i % 240 < 120 ? 'KeyW' : 'KeyS', 'ShiftLeft']))
    expect(p.state.stamina).toBe(0)
    expect(p.state.sprinting).toBe(false)
    expect(Math.hypot(p.state.vx, p.state.vz)).toBeCloseTo(PLAYER.walkSpeed, 1)
    for (let i = 0; i < 60 * 3; i++) p.update(1 / 60, fakeInput())
    expect(p.state.stamina).toBeGreaterThan(PLAYER.staminaRegen * 1.5)
    expect(p.state.stamina).toBeLessThan(PLAYER.staminaRegen * 3.5)
  })

  test('frozen input ignores keys and jumps but keeps gravity', () => {
    const p = new PlayerController(floorWorld(), { x: 0.5, y: 3, z: 0.5 })
    p.queueJump()
    for (let i = 0; i < 90; i++) p.update(1 / 60, fakeInput(['KeyW', 'ShiftLeft']), true)
    expect(p.state.x).toBe(0.5)
    expect(p.state.z).toBe(0.5)
    expect(p.state.y).toBeCloseTo(1, 2)
    expect(p.state.stamina).toBe(PLAYER.maxStamina)
  })

  test('falling into the void respawns on the pad', () => {
    const p = new PlayerController(new World(), { x: 5, y: 1, z: 5 })
    for (let i = 0; i < 600; i++) p.update(1 / 60, fakeInput())
    expect(p.state.y).toBeGreaterThan(PLAYER.voidY)
    expect([p.state.x, p.state.z]).toEqual([5, 5]) // back over the spawn column (still falling: empty world)
  })
})
