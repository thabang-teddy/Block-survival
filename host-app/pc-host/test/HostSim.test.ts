import { describe, expect, test } from 'vitest'
import { HostSim, RESPAWN_SECONDS, type Run } from '../src/sim/HostSim'
import { DEFAULT_RULES } from '@game/game/rules'
import { AIR, BLOCK } from '@game/world/palette'
import type { SaveData } from '@game/net/api'
import type { ClientMessage } from '@game/net/protocol'

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
    const s = sim()
    const ana = s.addPlayer('p1', 'Ana', 7)
    const ben = s.addPlayer('p2', 'Ben', 8)
    ana.inventory.add('log', 3)
    ben.inventory.add('stone', 2)
    const b = beside(s)
    s.world.setBlock(b.x, b.y, b.z, BLOCK.dirt)
    s.apply(ana, { t: 'break', ...b })
    const save: SaveData = JSON.parse(JSON.stringify(s.buildSave()))
    expect(Object.keys(save.players).sort()).toEqual(['7', '8'])

    const again = sim({ restore: save })
    expect(again.world.getBlock(b.x, b.y, b.z)).toBe(AIR)
    // everyone gets their gear back and starts at their spawn: the global world has no owner
    const back = again.addPlayer('q1', 'Ana', 7)
    expect(back.inventory.count('log')).toBe(3)
    expect(back.x).toBe(back.spawn.x)
    expect(again.addPlayer('q2', 'Ben', 8).inventory.count('stone')).toBe(2)
  })

  test('the save signature changes when something worth saving happens', () => {
    const s = sim()
    const a = s.addPlayer('p1', 'Sam', 7)
    const before = s.saveSignature()
    a.inventory.add('dirt', 1)
    expect(s.saveSignature()).not.toBe(before)
  })
})

describe('HostSim movement', () => {
  const input = (x: number, y: number, z: number): ClientMessage => ({ t: 'input', x, y, z, yaw: 0, pitch: 0, anim: 'Walk', slot: 0, aiming: false })

  test('a walk is accepted; a teleport is refused and the player is put back', () => {
    const s = sim()
    const a = s.addPlayer('p1', 'Sam', 7)
    const start = { x: a.x, y: a.y, z: a.z }
    s.apply(a, input(start.x + 0.2, start.y, start.z))
    expect(a.x).toBeCloseTo(start.x + 0.2)
    s.takeState(a)
    s.apply(a, input(start.x + 5000, start.y, start.z))
    expect(a.x).toBeCloseTo(start.x + 0.2)
    expect(s.takeState(a)?.teleport).toEqual({ x: a.x, y: a.y, z: a.z })
  })

  test('the further apart two inputs are in time, the further the player may have gone', () => {
    const s = sim()
    const a = s.addPlayer('p1', 'Sam', 7)
    s.apply(a, input(a.x, a.y, a.z))
    for (let i = 0; i < 20; i++) s.tick(1 / 20) // one second
    s.apply(a, input(a.x + 40, a.y, a.z))
    expect(s.takeState(a)?.teleport).toBeUndefined()
  })

  test('a player below the bedrock may go back to where they joined', () => {
    const s = sim()
    const a = s.addPlayer('p1', 'Sam', 7)
    const joined = { x: a.x, y: a.y, z: a.z }
    a.y = -20
    s.apply(a, input(joined.x, joined.y, joined.z))
    expect(a.y).toBeCloseTo(joined.y)
  })
})
