import { describe, expect, test } from 'vitest'
import { HostSim, RESPAWN_SECONDS, type Run } from '../HostSim'
import { DEFAULT_RULES } from '../../game/rules'
import { AIR, BLOCK } from '../../world/palette'
import type { SaveData } from '../../game/saveTypes'
import type { ClientMessage } from '../../net/protocol'

const SEED = 4242

function sim(over: Partial<ConstructorParameters<typeof HostSim>[0]> = {}): HostSim {
  return new HostSim({ seed: SEED, rules: DEFAULT_RULES, ...over })
}

/** a block to stand next to: one cell east of the spawn, on the pad's level + 1 */
function beside(s: HostSim): { x: number; y: number; z: number } {
  const sp = s.terrain.spawn()
  return { x: Math.floor(sp.x) + 2, y: Math.floor(sp.y), z: Math.floor(sp.z) }
}

describe('HostSim players', () => {
  test('a new player is welcomed with the seed, the world diff and their spawn', () => {
    const s = sim()
    const a = s.addPlayer('p1', 'Sam', 7)
    const w = s.welcome(a)
    expect(w).toMatchObject({ t: 'welcome', you: 'p1', seed: SEED, rules: { daySeconds: DEFAULT_RULES.daySeconds } })
    expect(w.spawn).toEqual({ x: a.x, y: a.y, z: a.z })
    expect(s.initialState(a)).toMatchObject({ t: 'state', health: 100, spawn: a.spawn })
    expect(s.snapshot().players.map(p => p.name)).toEqual(['Sam'])
  })

  test('private state goes out only when it changed', () => {
    const s = sim()
    const a = s.addPlayer('p1', 'Sam', 7)
    s.initialState(a)
    expect(s.takeState(a)).toBeNull()
    a.inventory.add('dirt', 3)
    expect(s.takeState(a)?.inventory).toBeDefined()
    expect(s.takeState(a)).toBeNull()
  })

  test('a player who leaves keeps their gear for when they come back, at their spawn', () => {
    const s = sim()
    const a = s.addPlayer('p1', 'Sam', 7)
    a.inventory.add('planks', 9)
    a.kills = 4
    a.x += 10
    s.removePlayer('p1')
    expect(s.avatars.size).toBe(0)
    const back = s.addPlayer('p2', 'Sam', 7)
    expect(back.inventory.count('planks')).toBe(9)
    expect(back.kills).toBe(4)
    expect(back.x).toBe(back.spawn.x)
  })
})

describe('HostSim actions', () => {
  test('breaking a block in reach removes it, drops its item and reports the edit', () => {
    const s = sim()
    const a = s.addPlayer('p1', 'Sam', 7)
    const b = beside(s)
    s.world.setBlock(b.x, b.y, b.z, BLOCK.dirt)
    s.takeBlockEdits()
    s.apply(a, { t: 'break', ...b })
    expect(s.world.getBlock(b.x, b.y, b.z)).toBe(AIR)
    expect(s.takeBlockEdits()).toEqual([{ ...b, id: AIR }])
    expect(s.drops.drops.map(d => d.item)).toEqual(['dirt'])
  })

  test('a break out of reach is ignored', () => {
    const s = sim()
    const a = s.addPlayer('p1', 'Sam', 7)
    const b = beside(s)
    s.world.setBlock(b.x + 20, b.y, b.z, BLOCK.dirt)
    s.apply(a, { t: 'break', x: b.x + 20, y: b.y, z: b.z })
    expect(s.world.getBlock(b.x + 20, b.y, b.z)).toBe(BLOCK.dirt)
  })

  test('placing takes one from the slot', () => {
    const s = sim()
    const a = s.addPlayer('p1', 'Sam', 7)
    a.inventory.add('dirt', 2)
    const b = beside(s)
    // the pad's surface under the target cell is solid; place on top of it
    const msg: ClientMessage = { t: 'place', x: b.x, y: b.y - 1, z: b.z, nx: 0, ny: 1, nz: 0, slot: 0, yaw: 0 }
    s.world.setBlock(b.x, b.y - 1, b.z, BLOCK.stone)
    s.world.setBlock(b.x, b.y, b.z, AIR)
    s.apply(a, msg)
    expect(s.world.getBlock(b.x, b.y, b.z)).toBe(BLOCK.dirt)
    expect(a.inventory.count('dirt')).toBe(1)
  })
})

describe('HostSim death and runs', () => {
  test('dying drops the inventory into a crate, records the run, and respawns after the delay', () => {
    const runs: Run[] = []
    const s = sim()
    s.onRun = run => runs.push(run)
    const a = s.addPlayer('p1', 'Sam', 7)
    a.inventory.add('planks', 5)
    a.damage(500)
    s.tick(1 / 30)
    expect(a.dead).toBe(true)
    expect(a.inventory.count('planks')).toBe(0)
    expect(s.crates.crates).toHaveLength(1)
    expect(runs).toEqual([expect.objectContaining({ userId: 7, deaths: 1 })])
    expect(s.takeState(a)).toMatchObject({ dead: true, respawnIn: RESPAWN_SECONDS })
    for (let t = 0; t < RESPAWN_SECONDS + 0.5; t += 1 / 20) s.tick(1 / 20)
    expect(a.dead).toBe(false)
    expect(a.health).toBe(100)
  })

  test('dawn records every player and asks for a save', () => {
    const rules = { ...DEFAULT_RULES, daySeconds: 30, nightSeconds: 30, zombiesFirstNight: 0, zombiesPerNight: 0 }
    const s = sim({ rules })
    const runs: Run[] = []
    let dawns = 0
    s.onRun = run => runs.push(run)
    s.onDawn = () => { dawns++ }
    s.addPlayer('p1', 'Sam', 7)
    s.addPlayer('p2', 'Kim', 8)
    for (let t = 0; t < 61; t += 1 / 20) s.tick(1 / 20)
    expect(dawns).toBe(1)
    expect(runs.map(r => r.userId).sort()).toEqual([7, 8])
    expect(runs[0].nights).toBe(1)
  })
})

describe('HostSim saving', () => {
  test('a save carries the edits and every player, and a new sim resumes from it', () => {
    const s = sim({ ownerId: 7 })
    const owner = s.addPlayer('p1', 'Owner', 7)
    const guest = s.addPlayer('p2', 'Guest', 8)
    owner.inventory.add('log', 3)
    guest.inventory.add('stone', 2)
    owner.x += 3
    const b = beside(s)
    s.world.setBlock(b.x, b.y, b.z, BLOCK.dirt)
    s.apply(owner, { t: 'break', ...b })
    const save: SaveData = JSON.parse(JSON.stringify(s.buildSave()))
    expect(Object.keys(save.players).sort()).toEqual(['7', '8'])

    const again = sim({ restore: save, ownerId: 7 })
    expect(again.world.getBlock(b.x, b.y, b.z)).toBe(AIR)
    const back = again.addPlayer('q1', 'Owner', 7)
    expect(back.inventory.count('log')).toBe(3)
    // the owner resumes where they stood; a visitor would start at their spawn
    expect(back.x).toBeCloseTo(owner.x)
    const visitor = again.addPlayer('q2', 'Guest', 8)
    expect(visitor.inventory.count('stone')).toBe(2)
    expect(visitor.x).toBe(visitor.spawn.x)
  })

  test('the save signature changes when something worth saving happens', () => {
    const s = sim()
    const a = s.addPlayer('p1', 'Sam', 7)
    const before = s.saveSignature()
    a.inventory.add('dirt', 1)
    expect(s.saveSignature()).not.toBe(before)
  })
})
