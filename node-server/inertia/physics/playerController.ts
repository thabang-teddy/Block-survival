/**
 * First-person player: mouse look, WASD, sprint, jump, gravity, step-up,
 * all resolved against the voxel world with swept AABBs.
 */
import type { World } from '../world/chunkStore.ts'
import { UPDRAFT, updraftAt, type Updraft } from '../world/updraft.ts'
import { boxIntersectsSolid, moveBox, type Box } from './aabb.ts'

export const PLAYER = {
  width: 0.6,
  height: 1.8,
  eyeHeight: 1.62,
  walkSpeed: 4.3,
  sprintSpeed: 7.0,
  jumpSpeed: 8.0,
  gravity: 25,
  stepHeight: 0.55,
  groundAccel: 40,
  airAccel: 10,
  mouseSensitivity: 0.0022,
  /** px of look applied in one tick at most: more than this is a stall, not a move */
  maxLookPerTick: 400,
  /** below the bedrock at y = 0: something went wrong, put the player back on the pad */
  voidY: -8,
  maxStamina: 100,
  staminaDrain: 15,
  staminaRegen: 12,
  staminaRegenDelay: 1.0,
} as const

/** the keys the controller reads (the browser's Input, or a stand-in in tests) */
export interface KeyState {
  isDown(code: string): boolean
}

/** normalise an angle into (-π, π] */
export function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2
  a = a % twoPi
  if (a > Math.PI) a -= twoPi
  else if (a <= -Math.PI) a += twoPi
  return a
}

export interface PlayerState {
  /** feet centre */
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  yaw: number
  pitch: number
  onGround: boolean
  stamina: number
  /** true while actually sprinting this tick */
  sprinting: boolean
  /** seconds since the player last sprinted */
  sinceSprint: number
  /** standing in an updraft shaft: Space rises, Shift sinks, otherwise hover */
  inUpdraft: boolean
}

export class PlayerController {
  readonly state: PlayerState
  /** respawn point (the bed sets this in Phase 5) */
  spawn: { x: number; y: number; z: number }
  private readonly world: World
  private jumpQueued = false
  /** the updraft shafts near a point (the terrain generator's; tests pass a fake) */
  updrafts: (x: number, z: number) => readonly Updraft[] = () => []

  constructor(world: World, spawn: { x: number; y: number; z: number }) {
    this.world = world
    this.spawn = { ...spawn }
    this.state = {
      x: spawn.x, y: spawn.y, z: spawn.z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: false,
      stamina: PLAYER.maxStamina, sprinting: false, sinceSprint: 99, inUpdraft: false,
    }
  }

  get box(): Box {
    const s = this.state
    const half = PLAYER.width / 2
    return { x: s.x - half, y: s.y, z: s.z - half, w: PLAYER.width, h: PLAYER.height, d: PLAYER.width }
  }

  /** would placing a solid block at this voxel overlap the player? */
  overlapsVoxel(x: number, y: number, z: number): boolean {
    const b = this.box
    return b.x < x + 1 && b.x + b.w > x && b.y < y + 1 && b.y + b.h > y && b.z < z + 1 && b.z + b.d > z
  }

  teleport(x: number, y: number, z: number): void {
    Object.assign(this.state, { x, y, z, vx: 0, vy: 0, vz: 0 })
  }

  queueJump(): void {
    this.jumpQueued = true
  }

  private updateVitals(dt: number, wantSprint: boolean, moving: boolean): void {
    const s = this.state
    s.sprinting = wantSprint && moving && s.stamina > 0 && s.onGround
    if (s.sprinting) {
      s.stamina = Math.max(0, s.stamina - PLAYER.staminaDrain * dt)
      s.sinceSprint = 0
    } else {
      s.sinceSprint += dt
      if (s.sinceSprint > PLAYER.staminaRegenDelay) s.stamina = Math.min(PLAYER.maxStamina, s.stamina + PLAYER.staminaRegen * dt)
    }
  }

  /**
   * Apply one tick of mouse delta (px). A delta that piled up during a frame stall is
   * capped rather than applied in one go; yaw stays in (-π, π] so it never loses precision.
   */
  look(dx: number, dy: number): void {
    const s = this.state
    const cap = PLAYER.maxLookPerTick
    dx = Math.max(-cap, Math.min(cap, dx))
    dy = Math.max(-cap, Math.min(cap, dy))
    s.yaw = wrapAngle(s.yaw - dx * PLAYER.mouseSensitivity)
    s.pitch -= dy * PLAYER.mouseSensitivity
    const limit = Math.PI / 2 - 0.01
    s.pitch = Math.max(-limit, Math.min(limit, s.pitch))
  }

  /** `frozen` (dead / in a menu): keys are ignored, only gravity applies */
  update(dt: number, input: KeyState, frozen = false): void {
    const s = this.state
    const down = (code: string): boolean => !frozen && input.isDown(code)
    // ---- wish direction in world space (yaw 0 looks down -Z)
    let fwd = 0
    let side = 0
    if (down('KeyW')) fwd += 1
    if (down('KeyS')) fwd -= 1
    if (down('KeyD')) side += 1
    if (down('KeyA')) side -= 1
    const len = Math.hypot(fwd, side) || 1
    fwd /= len
    side /= len
    const sinY = Math.sin(s.yaw)
    const cosY = Math.cos(s.yaw)
    const wishX = -sinY * fwd + cosY * side
    const wishZ = -cosY * fwd - sinY * side
    this.updateVitals(dt, down('ShiftLeft'), fwd !== 0 || side !== 0)
    const speed = s.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed
    const accel = (s.onGround ? PLAYER.groundAccel : PLAYER.airAccel) * dt
    s.vx += Math.max(-accel, Math.min(accel, wishX * speed - s.vx))
    s.vz += Math.max(-accel, Math.min(accel, wishZ * speed - s.vz))

    // ---- vertical
    const shaft = frozen ? null : updraftAt(this.updrafts(s.x, s.z), s.x, s.y, s.z)
    s.inUpdraft = shaft !== null
    if (shaft) {
      // the shaft carries you: ease towards rise / sink / hover, never past its top
      const want = down('Space') ? UPDRAFT.rise : down('ShiftLeft') ? -UPDRAFT.sink : 0
      const step = UPDRAFT.accel * dt
      s.vy += Math.max(-step, Math.min(step, want - s.vy))
      if (s.vy > 0 && s.y + s.vy * dt > shaft.topY) s.vy = Math.max(0, (shaft.topY - s.y) / dt)
    } else {
      if (this.jumpQueued && s.onGround && !frozen) s.vy = PLAYER.jumpSpeed
      s.vy -= PLAYER.gravity * dt
      s.vy = Math.max(s.vy, -50)
    }
    this.jumpQueued = false

    this.move(s.vx * dt, s.vy * dt, s.vz * dt)
    if (s.y < PLAYER.voidY) this.teleport(this.spawn.x, this.spawn.y, this.spawn.z)
  }

  private move(dx: number, dy: number, dz: number): void {
    const s = this.state
    let r = moveBox(this.world, this.box, dx, dy, dz)
    // step-up: blocked horizontally while grounded → try again from one step higher
    if ((r.hitX || r.hitZ) && s.onGround) {
      const raised = moveBox(this.world, this.box, 0, PLAYER.stepHeight, 0)
      if (!raised.hitY) {
        const stepped = moveBox(this.world, raised.box, dx, 0, dz)
        const settled = moveBox(this.world, stepped.box, 0, -PLAYER.stepHeight, 0)
        const gained = Math.hypot(stepped.box.x - raised.box.x, stepped.box.z - raised.box.z)
        const original = Math.hypot(r.box.x - this.box.x, r.box.z - this.box.z)
        if (gained > original + 1e-3 && settled.hitY && !boxIntersectsSolid(this.world, settled.box)) {
          r = { box: settled.box, hitX: stepped.hitX, hitZ: stepped.hitZ, hitY: true }
        }
      }
    }
    const half = PLAYER.width / 2
    s.x = r.box.x + half
    s.y = r.box.y
    s.z = r.box.z + half
    if (r.hitX) s.vx = 0
    if (r.hitZ) s.vz = 0
    if (r.hitY) {
      s.onGround = dy <= 0
      s.vy = 0
    } else {
      s.onGround = false
    }
  }
}
