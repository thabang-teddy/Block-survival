import { describe, expect, test } from 'vitest'
import { Inventory } from '../../items/inventory'
import type { SaveData, SavedPlayer } from '../../net/api'
import { collectSave, MAX_SAVED_DROPS, restorePlayer, savedPlayerOf, visitorsOf, zombiesToRestore, type SavableAvatar } from '../saveState'

function avatar(name: string, over: Partial<SavableAvatar> = {}): SavableAvatar {
  const inventory = new Inventory()
  inventory.add('planks', 12)
  return {
    name, inventory, spawn: { x: 0.5, y: 40, z: 0.5 }, x: 3, y: 41, z: -2, yaw: 1.2, pitch: -0.3,
    health: 77, magazine: 12, kills: 5, deaths: 1, ...over,
  }
}

const edits = [{ x: 1, y: 2, z: 3, id: 4 }]
const nothingLive = { zombies: [], drops: [], crates: [], departed: new Map<string, SavedPlayer>() }

describe('collectSave', () => {
  test('gathers the host, live visitors, departed visitors and the live world', () => {
    const host = avatar('Teddy')
    const guest = avatar('Sam', { kills: 9 })
    const departed = new Map<string, SavedPlayer>([['3', savedPlayerOf(avatar('Old'))]])
    const save = collectSave({
      seed: 11, time: 900, edits,
      live: [{ userId: '1', avatar: host }, { userId: '2', avatar: guest }],
      departed,
      zombies: [
        { kind: 'Basic', x: 1, y: 40, z: 1, hp: 30, state: 'chase' },
        { kind: 'Worker', x: 2, y: 40, z: 1, hp: 12, state: 'attack' },
        { kind: 'Basic', x: 3, y: 40, z: 1, hp: 30, state: 'burn' },
        { kind: 'Basic', x: 4, y: 40, z: 1, hp: 0, state: 'dead' },
      ],
      drops: [{ item: 'log', count: 3, x: 5, y: 41, z: 5 }],
      crates: [{ x: 6, y: 41, z: 6, items: [{ id: 'sword', count: 1 }] }],
      now: 1234,
    })
    expect(save.version).toBe(3)
    expect(save).toMatchObject({ seed: 11, time: 900, edits, savedAt: 1234 })
    expect(Object.keys(save.players).sort()).toEqual(['1', '2', '3'])
    expect(save.players['2'].kills).toBe(9)
    expect(save.players['1'].inventory).toEqual(host.inventory.all())
    expect(save.zombies).toEqual([
      { kind: 'Basic', x: 1, y: 40, z: 1, hp: 30 },
      { kind: 'Worker', x: 2, y: 40, z: 1, hp: 12 },
    ])
    expect(save.drops).toEqual([{ id: 'log', count: 3, x: 5, y: 41, z: 5 }])
    expect(save.crates).toEqual([{ x: 6, y: 41, z: 6, items: [{ id: 'sword', count: 1 }] }])
  })

  test('a connected player overrides their stale departed entry', () => {
    const live = avatar('Sam', { kills: 20 })
    const departed = new Map<string, SavedPlayer>([['2', savedPlayerOf(avatar('Sam', { kills: 3 }))]])
    const save = collectSave({ ...nothingLive, seed: 1, time: 0, edits: [], live: [{ userId: '2', avatar: live }], departed })
    expect(save.players['2'].kills).toBe(20)
  })

  test('keeps only the newest drops', () => {
    const drops = Array.from({ length: MAX_SAVED_DROPS + 10 }, (_, i) => ({ item: 'dirt', count: 1, x: i, y: 0, z: 0 }))
    const save = collectSave({ ...nothingLive, seed: 1, time: 0, edits: [], live: [], drops })
    expect(save.drops).toHaveLength(MAX_SAVED_DROPS)
    expect(save.drops[0].x).toBe(10)
  })

  test('copies inventories instead of sharing them', () => {
    const inventory = new Inventory()
    inventory.add('planks', 12)
    const host = avatar('Teddy', { inventory })
    const save = collectSave({ ...nothingLive, seed: 1, time: 0, edits: [], live: [{ userId: '1', avatar: host }] })
    inventory.add('planks', 1)
    expect(save.players['1'].inventory[0]).toEqual({ id: 'planks', count: 12 })
  })
})

describe('restorePlayer', () => {
  const saved: SavedPlayer = {
    name: 'Teddy', inventory: [{ id: 'sword', count: 1 }, null], spawn: { x: 9, y: 90, z: 9 },
    pos: { x: 100, y: 45, z: -100, yaw: 2, pitch: 0.5 }, health: 33, magazine: 7, kills: 4, deaths: 2,
  }

  test('the host resumes where they were, with their health and ammo', () => {
    const a = avatar('X')
    restorePlayer(a, saved, true)
    expect(a.inventory.all()[0]).toEqual({ id: 'sword', count: 1 })
    expect(a.spawn).toEqual({ x: 9, y: 90, z: 9 })
    expect([a.x, a.y, a.z, a.yaw, a.pitch]).toEqual([100, 45, -100, 2, 0.5])
    expect(a.health).toBe(33)
    expect(a.magazine).toBe(7)
    expect([a.kills, a.deaths]).toEqual([4, 2])
  })

  test('a visitor gets gear, spawn, score and ammo, not their position or health', () => {
    const a = avatar('X')
    restorePlayer(a, saved, false)
    expect(a.inventory.all()[0]).toEqual({ id: 'sword', count: 1 })
    expect(a.spawn).toEqual({ x: 9, y: 90, z: 9 })
    expect([a.x, a.y, a.z]).toEqual([3, 41, -2])
    expect(a.health).toBe(77)
    expect(a.magazine).toBe(7)
    expect([a.kills, a.deaths]).toEqual([4, 2])
  })

  test('round trip: savedPlayerOf then restorePlayer reproduces the avatar', () => {
    const a = avatar('Teddy')
    const b = avatar('Blank', { kills: 0, deaths: 0, health: 100, magazine: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 })
    restorePlayer(b, savedPlayerOf(a), true)
    expect(savedPlayerOf(b)).toEqual({ ...savedPlayerOf(a), name: 'Blank' })
  })
})

describe('zombiesToRestore / visitorsOf', () => {
  const base: SaveData = {
    version: 3, seed: 1, time: 100, edits: [], players: { '1': savedPlayerOf(avatar('H')), '2': savedPlayerOf(avatar('V')) },
    zombies: [{ kind: 'Basic', x: 0, y: 0, z: 0, hp: 1 }], drops: [], crates: [], savedAt: 0,
  }
  test('zombies come back only during a night', () => {
    expect(zombiesToRestore(base, () => 'night')).toBe(base.zombies)
    expect(zombiesToRestore(base, () => 'day')).toEqual([])
  })
  test('visitors are everyone but the host', () => {
    const v = visitorsOf(base, '1')
    expect([...v.keys()]).toEqual(['2'])
    expect(v.get('2')!.name).toBe('V')
  })
})
