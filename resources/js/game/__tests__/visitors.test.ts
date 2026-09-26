import { describe, expect, test } from 'vitest'
import { Inventory } from '../../items/inventory'
import { savedPlayerOf, type SavableAvatar } from '../saveState'
import { Visitors } from '../visitors'

type TestAvatar = Omit<SavableAvatar, 'inventory'> & { inventory: Inventory }

function avatar(name: string, over: Partial<Omit<TestAvatar, 'inventory'>> = {}): TestAvatar {
  return {
    name, inventory: new Inventory(), spawn: { x: 0.5, y: 40, z: 0.5 }, x: 0.5, y: 40, z: 0.5, yaw: 0, pitch: 0,
    health: 100, magazine: 0, kills: 0, deaths: 0, ...over,
  }
}

describe('Visitors', () => {
  test('a returning account gets its gear, spawn and score but not its old position', () => {
    const sam = avatar('Sam', { x: 50, y: 45, z: 50, kills: 7, health: 20, magazine: 9 })
    sam.inventory.add('sword', 1)
    const book = new Visitors()
    book.leave(sam, 2)
    expect([...book.entries.keys()]).toEqual(['2'])

    const back = avatar('Sam again')
    expect(book.arrive(back, 2)).toBe(true)
    expect(back.inventory.count('sword')).toBe(1)
    expect(back.kills).toBe(7)
    expect(back.magazine).toBe(9)
    expect([back.x, back.y, back.z]).toEqual([0.5, 40, 0.5])
    expect(back.health).toBe(100)
    expect(book.entries.size).toBe(0)
  })

  test('arriving twice does not restore twice', () => {
    const book = new Visitors([['2', savedPlayerOf(avatar('Sam', { kills: 3 }))]])
    expect(book.arrive(avatar('a'), 2)).toBe(true)
    const second = avatar('b')
    expect(book.arrive(second, 2)).toBe(false)
    expect(second.kills).toBe(0)
  })

  test('unknown accounts and anonymous players are left alone', () => {
    const book = new Visitors([['2', savedPlayerOf(avatar('Sam', { kills: 3 }))]])
    const a = avatar('x')
    expect(book.arrive(a, 9)).toBe(false)
    expect(book.arrive(a, null)).toBe(false)
    book.leave(a, null)
    expect(book.entries.size).toBe(1)
  })

  test('leaving again after a return overwrites the kept entry', () => {
    const book = new Visitors([['2', savedPlayerOf(avatar('Sam', { kills: 3 }))]])
    const a = avatar('Sam')
    book.arrive(a, 2)
    a.kills = 12
    book.leave(a, 2)
    expect(book.entries.get('2')!.kills).toBe(12)
  })
})
