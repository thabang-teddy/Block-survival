import { describe, expect, test } from 'vitest'
import { World } from '../../world/chunkStore'
import { AIR, BLOCK } from '../../world/palette'
import { makeRng } from '../../world/noise'
import { findPath, isStanding, standingCellAt } from '../pathfinding'
import { blockHitPoints, kindsForNight, ZombieManager, zombiesForNight, ZOMBIE, ZOMBIE_STATS } from '../zombies'
import { DayNight, DAY_SECONDS, CYCLE_SECONDS } from '../../game/DayNight'

/** flat stone floor at y = 0 from -R..R */
function floor(R = 20): World {
  const w = new World()
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) w.setBlock(x, 0, z, BLOCK.grass)
  return w
}

describe('DayNight', () => {
  test('5 min day, 5 min night, first zombies at the first sunset', () => {
    const d = new DayNight()
    expect(d.phase).toBe('day')
    expect(d.night).toBe(0)
    expect(d.timerText).toBe('5:00')
    d.update(DAY_SECONDS - 1)
    expect(d.phase).toBe('day')
    expect(d.timerText).toBe('0:01')
    d.update(1.5)
    expect(d.phase).toBe('night')
    expect(d.justChanged).toBe(true)
    expect(d.night).toBe(1)
    d.update(0.1)
    expect(d.justChanged).toBe(false)
    d.update(CYCLE_SECONDS) // a full cycle later: night 2
    expect(d.phase).toBe('night')
    expect(d.night).toBe(2)
  })

  test('sky blends: bright at noon, dark at midnight, sunset in between', () => {
    const d = new DayNight()
    d.time = DAY_SECONDS / 2
    expect(d.sky().day).toBe(1)
    expect(d.sky().sunY).toBeGreaterThan(0.9)
    d.time = DAY_SECONDS + 150
    expect(d.sky().night).toBe(1)
    expect(d.sky().sunY).toBeLessThan(0)
    d.time = DAY_SECONDS
    expect(d.sky().sunset).toBeGreaterThan(0.9)
  })
})

describe('pathfinding', () => {
  test('standing cells need air for 2 blocks and a solid floor', () => {
    const w = floor()
    expect(isStanding(w, 0, 1, 0)).toBe(true)
    expect(isStanding(w, 0, 2, 0)).toBe(false)
    expect(isStanding(w, 0, 0, 0)).toBe(false)
    expect(standingCellAt(w, 3.7, 1.4, -2.2)).toEqual({ x: 3, y: 1, z: -3 })
    expect(standingCellAt(w, 3.7, 3.0, -2.2)).toEqual({ x: 3, y: 1, z: -3 }) // mid-air: drops to the floor
  })

  test('walks straight across open ground and stops adjacent to the goal', () => {
    const w = floor()
    const r = findPath(w, { x: 0, y: 1, z: 0 }, { x: 6, y: 1, z: 0 })
    expect(r.reached).toBe(true)
    expect(r.path.length).toBe(5)
    expect(r.path[r.path.length - 1]).toEqual({ x: 5, y: 1, z: 0 })
  })

  test('routes around a wall and steps up over a single block', () => {
    const w = floor()
    for (let z = -3; z <= 3; z++) for (let y = 1; y <= 3; y++) w.setBlock(3, y, z, BLOCK.stone)
    const around = findPath(w, { x: 0, y: 1, z: 0 }, { x: 6, y: 1, z: 0 })
    expect(around.reached).toBe(true)
    expect(around.path.some(c => Math.abs(c.z) >= 4)).toBe(true)
    expect(around.path.every(c => !(c.x === 3 && Math.abs(c.z) <= 3))).toBe(true)

    const w2 = floor()
    for (let z = -20; z <= 20; z++) w2.setBlock(3, 1, z, BLOCK.stone) // 1-high ridge across the map
    const over = findPath(w2, { x: 0, y: 1, z: 0 }, { x: 6, y: 1, z: 0 })
    expect(over.reached).toBe(true)
    expect(over.path.some(c => c.x === 3 && c.y === 2)).toBe(true)
  })

  test('an unreachable goal returns the closest partial path', () => {
    const w = floor(8)
    for (let x = -8; x <= 8; x++) for (let y = 1; y <= 4; y++) w.setBlock(x, y, 2, BLOCK.stone) // full wall
    const r = findPath(w, { x: 0, y: 1, z: -5 }, { x: 0, y: 1, z: 6 })
    expect(r.reached).toBe(false)
    expect(r.path.length).toBeGreaterThan(0)
    expect(r.path[r.path.length - 1].z).toBe(1) // right up against the wall
  })
})

describe('zombies', () => {
  const host = (w: World) => {
    const hits: { player: number; poison: boolean }[] = []
    const broken: number[][] = []
    return {
      hits, broken,
      world: w,
      damagePlayer: (amount: number, poison: boolean) => { hits.push({ player: amount, poison }) },
      breakBlock: (x: number, y: number, z: number) => { broken.push([x, y, z]); w.setBlock(x, y, z, AIR) },
    }
  }

  test('spawn schedule and variant mix follow the spec', () => {
    expect(zombiesForNight(1)).toBe(8)
    expect(zombiesForNight(3)).toBe(20)
    expect(kindsForNight(1)).toEqual(['Basic'])
    expect(kindsForNight(4)).toEqual(['Basic', 'Worker', 'Soldier', 'Toxic'])
    expect(blockHitPoints(BLOCK.reinforced_wall)).toBeUndefined()
    expect(blockHitPoints(BLOCK.cobble)).toBe(15)
  })

  test('a zombie chases the player and attacks with its cooldown', () => {
    const w = floor()
    const h = host(w)
    const zm = new ZombieManager(h, makeRng(1))
    zm.spawn('Basic', 0.5, 1, 0.5)
    const target = { x: 8.5, y: 1, z: 0.5 }
    for (let i = 0; i < 60 * 6; i++) zm.update(1 / 60, [target])
    const z = zm.zombies[0]
    expect(Math.hypot(z.x - target.x, z.z - target.z)).toBeLessThanOrEqual(ZOMBIE.attackRange + 0.2)
    expect(z.state).toBe('attack')
    expect(h.hits.length).toBeGreaterThanOrEqual(3)
    expect(h.hits.length).toBeLessThanOrEqual(5) // ~1.2 s cooldown over the remaining time
    expect(h.hits[0]).toEqual({ player: ZOMBIE_STATS.Basic.damage, poison: false })
  })

  test('a walled-off zombie breaks through dirt but not a reinforced wall', () => {
    const w = floor(8)
    for (let x = -8; x <= 8; x++) for (let y = 1; y <= 3; y++) w.setBlock(x, y, 2, BLOCK.dirt)
    const h = host(w)
    const zm = new ZombieManager(h, makeRng(2))
    zm.spawn('Worker', 0.5, 1, -2.5)
    const target = { x: 0.5, y: 1, z: 5.5 }
    for (let i = 0; i < 60 * 6; i++) zm.update(1 / 60, [target])
    expect(h.broken.length).toBeGreaterThan(0)
    expect(h.broken.every(([, , bz]) => bz === 2)).toBe(true)

    const w2 = floor(8)
    for (let x = -8; x <= 8; x++) for (let y = 1; y <= 3; y++) w2.setBlock(x, y, 2, BLOCK.reinforced_wall)
    const h2 = host(w2)
    const zm2 = new ZombieManager(h2, makeRng(2))
    zm2.spawn('Worker', 0.5, 1, -2.5)
    for (let i = 0; i < 60 * 6; i++) zm2.update(1 / 60, [target])
    expect(h2.broken).toEqual([])
  })

  test('damage, knockback, death and dawn burn', () => {
    const w = floor()
    const zm = new ZombieManager(host(w), makeRng(3))
    const z = zm.spawn('Toxic', 0.5, 1, 0.5)
    expect(zm.damage(z, 10, 5, 0)).toBe(false)
    expect(z.hp).toBe(15)
    expect(z.vx).toBe(5)
    expect(zm.damage(z, 20)).toBe(true)
    expect(zm.kills).toBe(1)
    expect(z.state).toBe('dead')
    for (let i = 0; i < 100; i++) zm.update(1 / 60, [])
    expect(zm.zombies).toHaveLength(0)

    zm.spawn('Basic', 0.5, 1, 0.5)
    zm.burnAll()
    expect(zm.liveCount).toBe(0)
    expect(zm.zombies[0].state).toBe('burn')
    for (let i = 0; i < 60 * 11; i++) zm.update(1 / 60, [])
    expect(zm.zombies).toHaveLength(0)
  })

  test('spawnGroup keeps its distance from the player and respects the cap', () => {
    const w = floor(30)
    const zm = new ZombieManager(host(w), makeRng(4))
    const target = { x: 0.5, y: 1, z: 0.5 }
    const n = zm.spawnGroup(['Basic'], 5, [target], 28)
    expect(n).toBe(5)
    for (const z of zm.zombies) expect(Math.hypot(z.x, z.z)).toBeGreaterThanOrEqual(ZOMBIE.minSpawnDistance - 3)
    for (let i = 0; i < 20; i++) zm.spawnGroup(['Basic'], 6, [target], 28)
    expect(zm.liveCount).toBeLessThanOrEqual(ZOMBIE.maxLive + 5)
  })
})
