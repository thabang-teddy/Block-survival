/**
 * Zombie simulation: variants, night spawning schedule, chase AI on the voxel
 * pathfinder, attacks on players and on the blocks in their way.
 * Rendering lives in render/ZombieRenderer.ts.
 */
import type { World } from '../world/chunkStore'
import { AIR, BLOCK, isProp, isSolid } from '../world/palette'
import { moveBox } from '../physics/aabb'
import { findPath, standingCellAt, type Cell } from './pathfinding'
import type { Rng } from '../world/noise'

export type ZombieKind = 'Basic' | 'Worker' | 'Soldier' | 'Toxic'

export interface ZombieStats {
  hp: number
  speed: number
  damage: number
  /** block damage per hit (blocks have hit-point counts) */
  blockDamage: number
  /** multiplier on rifle damage */
  rifleResist: number
  poisons: boolean
}

export const ZOMBIE_STATS: Readonly<Record<ZombieKind, ZombieStats>> = {
  Basic: { hp: 30, speed: 2.0, damage: 4, blockDamage: 1, rifleResist: 1, poisons: false },
  Worker: { hp: 50, speed: 1.8, damage: 5, blockDamage: 3, rifleResist: 1, poisons: false },
  Soldier: { hp: 80, speed: 2.2, damage: 7, blockDamage: 1, rifleResist: 0.5, poisons: false },
  Toxic: { hp: 25, speed: 3.2, damage: 3, blockDamage: 1, rifleResist: 1, poisons: true },
}

/** Hits a zombie needs to destroy a block; undefined = cannot. */
export function blockHitPoints(id: number): number | undefined {
  switch (id) {
    case BLOCK.dirt: case BLOCK.sand: case BLOCK.gravel: case BLOCK.leaves: case BLOCK.grass: case BLOCK.snow: return 3
    case BLOCK.planks: case BLOCK.glass: return 5
    case BLOCK.log: return 8
    case BLOCK.cobble: case BLOCK.stone: case BLOCK.ore_coal: case BLOCK.ore_iron: return 15
    case BLOCK.torch: case BLOCK.workbench: case BLOCK.bed: return 2
    default: return undefined // air, water, reinforced wall
  }
}

/** Which variants a night can spawn (spec §4). */
export function kindsForNight(night: number): ZombieKind[] {
  const kinds: ZombieKind[] = ['Basic']
  if (night >= 2) kinds.push('Worker')
  if (night >= 3) kinds.push('Soldier')
  if (night >= 4) kinds.push('Toxic')
  return kinds
}

export const zombiesForNight = (night: number): number => 8 + 6 * (night - 1)

export interface Zombie {
  id: number
  kind: ZombieKind
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** facing; model faces +Z at yaw 0 */
  yaw: number
  hp: number
  onGround: boolean
  /** 'burn' at dawn / 'dead' after a kill; removed when burnTimer reaches 0 */
  state: 'chase' | 'attack' | 'burn' | 'dead'
  burnTimer: number
  path: Cell[]
  repathIn: number
  attackCooldown: number
  stuckTime: number
  /** set for one tick when an attack animation should play */
  attacked: boolean
}

export interface ZombieTarget {
  x: number
  y: number
  z: number
}

export interface ZombieHost {
  world: World
  damagePlayer(amount: number, poison: boolean): void
  /** break a block the zombie destroyed (drops, props) */
  breakBlock(x: number, y: number, z: number): void
}

export const ZOMBIE = {
  width: 0.6,
  height: 1.8,
  gravity: 25,
  jumpSpeed: 8,
  accel: 25,
  attackRange: 1.6,
  attackSeconds: 1.2,
  blockHitSeconds: 1.0,
  repathSeconds: 0.5,
  stuckSeconds: 0.5,
  maxLive: 40,
  minSpawnDistance: 20,
  burnSeconds: 10,
  deathSeconds: 1.2,
  /** pathfinding time budget per update call (ms); searches beyond it wait for the next tick */
  pathBudgetMs: 1.5,
  pathMaxNodes: 500,
  /** beyond this distance zombies walk straight at the target instead of searching */
  pathMaxDistance: 40,
} as const

export class ZombieManager {
  readonly zombies: Zombie[] = []
  kills = 0
  private nextId = 1
  private readonly host: ZombieHost
  private readonly rng: Rng
  /** accumulated hits on blocks, keyed "x,y,z" */
  private readonly blockDamage = new Map<string, number>()

  constructor(host: ZombieHost, rng: Rng) {
    this.host = host
    this.rng = rng
  }

  get liveCount(): number {
    return this.zombies.filter(z => z.state === 'chase' || z.state === 'attack').length
  }

  spawn(kind: ZombieKind, x: number, y: number, z: number): Zombie {
    const zb: Zombie = {
      id: this.nextId++, kind, x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0,
      hp: ZOMBIE_STATS[kind].hp, onGround: false, state: 'chase', burnTimer: 0,
      path: [], repathIn: this.rng.random() * ZOMBIE.repathSeconds, attackCooldown: 0.5, stuckTime: 0, attacked: false,
    }
    this.zombies.push(zb)
    return zb
  }

  /**
   * Spawn a group at a grass cell on the island rim, ≥ minSpawnDistance from every target.
   * Returns how many were spawned (0 if no spot was found or the cap is reached).
   */
  spawnGroup(kinds: ZombieKind[], count: number, targets: ZombieTarget[], radius: number): number {
    const world = this.host.world
    let spawned = 0
    for (let attempt = 0; attempt < 40 && spawned < count; attempt++) {
      if (this.liveCount >= ZOMBIE.maxLive) break
      const angle = this.rng.random() * Math.PI * 2
      const dist = radius * (0.6 + this.rng.random() * 0.35)
      const x = Math.round(Math.cos(angle) * dist)
      const z = Math.round(Math.sin(angle) * dist)
      const y = this.grassTop(x, z)
      if (y === null) continue
      if (targets.some(t => Math.hypot(t.x - x, t.z - z) < ZOMBIE.minSpawnDistance)) continue
      // scatter the group around the spot
      for (let i = 0; i < count && spawned < count; i++) {
        const sx = x + this.rng.randint(-2, 2)
        const sz = z + this.rng.randint(-2, 2)
        const sy = this.grassTop(sx, sz) ?? y
        if (!isSolid(world.getBlock(sx, sy, sz)) && !isSolid(world.getBlock(sx, sy + 1, sz))) {
          this.spawn(kinds[this.rng.randint(0, kinds.length - 1)], sx + 0.5, sy, sz + 0.5)
          spawned++
        }
      }
    }
    return spawned
  }

  /** standing y above the top grass block of a column, or null */
  private grassTop(x: number, z: number): number | null {
    const world = this.host.world
    for (let y = world.bounds.maxY; y >= world.bounds.minY; y--) {
      const id = world.getBlock(x, y, z)
      if (id === AIR || isProp(id)) continue
      return id === BLOCK.grass || id === BLOCK.sand ? y + 1 : null
    }
    return null
  }

  /** Dawn: everything left burns away. */
  burnAll(): void {
    for (const z of this.zombies) {
      if (z.state === 'chase' || z.state === 'attack') {
        z.state = 'burn'
        z.burnTimer = ZOMBIE.burnSeconds
      }
    }
  }

  /** Apply damage; returns true if this hit killed it. */
  damage(z: Zombie, amount: number, knockX = 0, knockZ = 0): boolean {
    if (z.state === 'dead' || z.state === 'burn') return false
    z.hp -= amount
    z.vx += knockX
    z.vz += knockZ
    if (knockX || knockZ) z.vy = Math.max(z.vy, 3)
    if (z.hp <= 0) {
      z.state = 'dead'
      z.burnTimer = ZOMBIE.deathSeconds
      this.kills++
      return true
    }
    return false
  }

  update(dt: number, targets: ZombieTarget[]): void {
    const budgetEnd = performance.now() + ZOMBIE.pathBudgetMs
    for (const z of this.zombies.slice()) {
      z.attacked = false
      if (z.state === 'burn' || z.state === 'dead') {
        z.burnTimer -= dt
        if (z.burnTimer <= 0) this.zombies.splice(this.zombies.indexOf(z), 1)
        continue
      }
      const target = this.nearest(z, targets)
      if (!target) {
        this.physics(z, dt, 0, 0)
        continue
      }
      const dx = target.x - z.x
      const dz = target.z - z.z
      const horiz = Math.hypot(dx, dz)
      z.attackCooldown = Math.max(0, z.attackCooldown - dt)

      if (horiz <= ZOMBIE.attackRange && Math.abs(target.y - z.y) <= 1.6) {
        z.state = 'attack'
        z.yaw = Math.atan2(dx, dz)
        if (z.attackCooldown === 0) {
          const st = ZOMBIE_STATS[z.kind]
          this.host.damagePlayer(st.damage, st.poisons)
          z.attackCooldown = ZOMBIE.attackSeconds
          z.attacked = true
        }
        this.physics(z, dt, 0, 0)
        continue
      }

      z.state = 'chase'
      z.repathIn -= dt
      if (z.repathIn <= 0 && performance.now() < budgetEnd) {
        z.repathIn = ZOMBIE.repathSeconds
        if (horiz > ZOMBIE.pathMaxDistance) z.path = []
        else {
          const from = standingCellAt(this.host.world, z.x, z.y, z.z)
          const to = standingCellAt(this.host.world, target.x, target.y, target.z)
          z.path = findPath(this.host.world, from, to, ZOMBIE.pathMaxNodes).path
        }
      }
      // next waypoint (or straight at the target when there is no path)
      let wx = target.x
      let wz = target.z
      let wy = target.y
      while (z.path.length) {
        const c = z.path[0]
        if (Math.hypot(c.x + 0.5 - z.x, c.z + 0.5 - z.z) < 0.4 && Math.abs(c.y - z.y) < 1.1) {
          z.path.shift()
          continue
        }
        wx = c.x + 0.5
        wz = c.z + 0.5
        wy = c.y
        break
      }
      const mx = wx - z.x
      const mz = wz - z.z
      const ml = Math.hypot(mx, mz) || 1
      z.yaw = Math.atan2(mx, mz)
      if (wy > z.y + 0.5 && z.onGround && ml < 1.4) z.vy = ZOMBIE.jumpSpeed
      const speed = ZOMBIE_STATS[z.kind].speed
      const blocked = this.physics(z, dt, (mx / ml) * speed, (mz / ml) * speed)
      if (blocked) {
        z.stuckTime += dt
        if (z.stuckTime >= ZOMBIE.stuckSeconds) this.attackBlockAhead(z, wy)
      } else {
        z.stuckTime = 0
      }
    }
  }

  private nearest(z: Zombie, targets: ZombieTarget[]): ZombieTarget | null {
    let best: ZombieTarget | null = null
    let bestD = Infinity
    for (const t of targets) {
      const d = Math.hypot(t.x - z.x, t.y - z.y, t.z - z.z)
      if (d < bestD) { bestD = d; best = t }
    }
    return best
  }

  /** Integrate one step; returns true if horizontal movement was blocked. */
  private physics(z: Zombie, dt: number, wishX: number, wishZ: number): boolean {
    const a = ZOMBIE.accel * dt
    z.vx += Math.max(-a, Math.min(a, wishX - z.vx))
    z.vz += Math.max(-a, Math.min(a, wishZ - z.vz))
    z.vy = Math.max(-50, z.vy - ZOMBIE.gravity * dt)
    const half = ZOMBIE.width / 2
    const box = { x: z.x - half, y: z.y, z: z.z - half, w: ZOMBIE.width, h: ZOMBIE.height, d: ZOMBIE.width }
    const r = moveBox(this.host.world, box, z.vx * dt, z.vy * dt, z.vz * dt)
    z.x = r.box.x + half
    z.y = r.box.y
    z.z = r.box.z + half
    if (r.hitY) { z.onGround = z.vy <= 0; z.vy = 0 } else z.onGround = false
    if (r.hitX) z.vx = 0
    if (r.hitZ) z.vz = 0
    if (z.y < -60) { z.state = 'dead'; z.burnTimer = 0 }
    return (r.hitX || r.hitZ) && (wishX !== 0 || wishZ !== 0)
  }

  /** Hit the block in the zombie's way (chest height, then feet, then the block below a higher waypoint). */
  private attackBlockAhead(z: Zombie, waypointY: number): void {
    if (z.attackCooldown > 0) return
    const fx = Math.floor(z.x + Math.sin(z.yaw) * 0.7)
    const fz = Math.floor(z.z + Math.cos(z.yaw) * 0.7)
    const fy = Math.floor(z.y)
    const candidates: Cell[] = [
      { x: fx, y: fy + 1, z: fz }, { x: fx, y: fy, z: fz },
      { x: fx, y: fy + 2, z: fz }, { x: Math.floor(z.x), y: fy + 2, z: Math.floor(z.z) },
    ]
    if (waypointY > z.y + 1.5) candidates.push({ x: Math.floor(z.x), y: fy + 2, z: Math.floor(z.z) })
    for (const c of candidates) {
      const id = this.host.world.getBlock(c.x, c.y, c.z)
      const hp = blockHitPoints(id)
      if (hp === undefined || !isSolid(id) && !isProp(id)) continue
      const k = `${c.x},${c.y},${c.z}`
      const dmg = (this.blockDamage.get(k) ?? 0) + ZOMBIE_STATS[z.kind].blockDamage
      z.attackCooldown = ZOMBIE.blockHitSeconds
      z.attacked = true
      if (dmg >= hp) {
        this.blockDamage.delete(k)
        this.host.breakBlock(c.x, c.y, c.z)
      } else {
        this.blockDamage.set(k, dmg)
      }
      return
    }
  }

  /** hits accumulated on a block (for tests / crack overlay) */
  blockHits(x: number, y: number, z: number): number {
    return this.blockDamage.get(`${x},${y},${z}`) ?? 0
  }
}
