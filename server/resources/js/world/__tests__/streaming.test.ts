import { describe, expect, test } from 'vitest'
import { CHUNK, columnFromKey, columnKey, localIndex, World, type ChunkGenerator } from '../chunkStore'
import { AIR, BLOCK } from '../palette'
import { ChunkStreamer, planStream } from '../chunkStreamer'

/** flat world: stone up to y = 3 in every column, air above; 2 chunks high */
const CHUNKS_Y = 2
const flatGen: ChunkGenerator = (_cx, cy, _cz) => {
  if (cy !== 0) return null
  const d = new Uint8Array(CHUNK * CHUNK * CHUNK)
  for (let x = 0; x < CHUNK; x++) for (let z = 0; z < CHUNK; z++) for (let y = 0; y <= 3; y++) d[localIndex(x, y, z)] = BLOCK.stone
  return d
}

const streamed = (): World => {
  const w = new World()
  w.setGenerator(flatGen, CHUNKS_Y)
  w.trackEdits = true
  return w
}

describe('World streamed mode', () => {
  test('loadColumn generates chunks and getBlock works far from the origin', () => {
    const w = streamed()
    const x = 1_000_000
    const z = -1_000_000
    expect(w.isColumnLoaded(x, z)).toBe(false)
    w.loadColumn(x >> 4, z >> 4)
    expect(w.isColumnLoaded(x, z)).toBe(true)
    expect(w.getBlock(x, 3, z)).toBe(BLOCK.stone)
    expect(w.getBlock(x, 4, z)).toBe(AIR)
    expect(w.chunkCount).toBe(1) // the all-air upper chunk costs nothing
    // keys never collide across a wide range
    const keys = new Set<number>()
    for (const cx of [-1_000_000, -513, -1, 0, 1, 512, 1_000_000]) for (const cz of [-1_000_000, -513, 0, 513, 1_000_000]) keys.add(columnKey(cx, cz))
    expect(keys.size).toBe(35)
    expect(columnFromKey(columnKey(-70_000, 12_345))).toEqual({ cx: -70_000, cz: 12_345 })
  })

  test('edits and props survive unload → reload; unloaded chunks are reported', () => {
    const w = streamed()
    w.loadColumn(2, 3)
    w.setBlock(40, 4, 50, BLOCK.planks) // placed
    w.setBlock(41, 3, 50, AIR) // dug
    w.setProp({ id: BLOCK.torch, x: 42, y: 4, z: 50, yaw: 0, primary: true })
    w.setBlock(40, 20, 50, BLOCK.glass) // in the all-air chunk above: allocates it
    expect(w.chunkCount).toBe(2)
    w.takeDirty()

    w.unloadColumn(2, 3)
    expect(w.chunkCount).toBe(0)
    expect(w.takeRemoved().sort()).toEqual(['2,0,3', '2,1,3'])
    expect(w.getBlock(40, 4, 50)).toBe(AIR)
    expect(w.edits.size).toBe(4)
    expect(w.getProp(42, 4, 50)?.id).toBe(BLOCK.torch)

    w.loadColumn(2, 3)
    expect(w.getBlock(40, 4, 50)).toBe(BLOCK.planks)
    expect(w.getBlock(41, 3, 50)).toBe(AIR)
    expect(w.getBlock(42, 4, 50)).toBe(BLOCK.torch)
    expect(w.getBlock(40, 20, 50)).toBe(BLOCK.glass)
    expect(w.getBlock(43, 3, 50)).toBe(BLOCK.stone) // untouched generated block
    expect(w.takeDirty().sort()).toEqual(['2,0,3', '2,1,3'])
    expect([...w.editsInChunk(2, 0, 3)]).toHaveLength(3)
  })

  test('setBlock on an unloaded column only records the edit, applied when it loads', () => {
    const w = streamed()
    w.setBlock(100, 5, 100, BLOCK.cobble)
    expect(w.chunkCount).toBe(0)
    expect(w.getBlock(100, 5, 100)).toBe(AIR)
    expect(w.edits.get('100,5,100')).toEqual({ x: 100, y: 5, z: 100, id: BLOCK.cobble })
    w.loadColumn(6, 6)
    expect(w.getBlock(100, 5, 100)).toBe(BLOCK.cobble)
  })

  test('loading a column re-dirties its already-loaded neighbours', () => {
    const w = streamed()
    w.loadColumn(0, 0)
    w.takeDirty()
    w.loadColumn(1, 0)
    expect(w.takeDirty().sort()).toEqual(['0,0,0', '1,0,0'])
  })
})

describe('planStream', () => {
  const key = (cx: number, cz: number): number => columnKey(cx, cz)

  test('loads a disc of columns nearest-first and nothing already loaded', () => {
    const loaded = new Set([key(0, 0)])
    const plan = planStream(loaded, [{ x: 8, z: 8 }], [], 3, 2)
    expect(Math.abs(plan.load[0].cx) + Math.abs(plan.load[0].cz)).toBe(1) // a direct neighbour comes first
    expect(plan.load.find(c => c.cx === 0 && c.cz === 0)).toBeUndefined()
    expect(plan.load.find(c => c.cx === 3 && c.cz === 3)).toBeUndefined() // corner of the square: outside the disc
    expect(plan.load.find(c => c.cx === 3 && c.cz === 0)).toBeDefined()
    expect(plan.unload).toEqual([])
    for (let i = 1; i < plan.load.length; i++) {
      const d = (c: { cx: number; cz: number }): number => (c.cx + 0.5 - 0.5) ** 2 + (c.cz + 0.5 - 0.5) ** 2
      expect(d(plan.load[i])).toBeGreaterThanOrEqual(d(plan.load[i - 1]))
    }
  })

  test('unloads only beyond radius + margin, never a kept column', () => {
    const loaded = new Set([key(4, 0), key(5, 0), key(9, 0), key(-9, 0)])
    const plan = planStream(loaded, [{ x: 8, z: 8 }], [{ x: 9 * CHUNK + 1, z: 1 }], 3, 2)
    expect(plan.unload).toEqual([{ cx: -9, cz: 0 }]) // 4 and 5 are inside the hysteresis band, 9 is kept
  })

  test('unions the discs of several anchors', () => {
    const plan = planStream(new Set(), [{ x: 0, z: 0 }, { x: 100 * CHUNK, z: 0 }], [], 1, 0)
    expect(plan.load.some(c => c.cx === 0)).toBe(true)
    expect(plan.load.some(c => c.cx === 100)).toBe(true)
    expect(plan.load.some(c => c.cx === 50)).toBe(false)
  })
})

describe('ChunkStreamer', () => {
  test('loadNow loads the whole disc; update respects the per-frame budget', () => {
    const w = streamed()
    const s = new ChunkStreamer(w, { radius: 4, budgetMs: 0 })
    s.loadNow(8, 8, 1)
    expect(s.loadedCount).toBe(9) // the 3×3 block: diagonals are within 1.5 chunks
    expect(w.isColumnLoaded(20, 8)).toBe(true)
    // budget 0 → exactly one column per frame
    s.update([{ x: 8, z: 8 }])
    expect(s.loadedCount).toBe(10)
    for (let i = 0; i < 200; i++) s.update([{ x: 8, z: 8 }])
    const full = s.loadedCount
    expect(full).toBeGreaterThan(40)
    // walk away: columns behind us unload, the count stays bounded
    for (let step = 0; step < 300; step++) s.update([{ x: 8 + step * 4, z: 8 }])
    expect(s.loadedCount).toBeLessThanOrEqual(full + 30)
    expect(w.isColumnLoaded(8, 8)).toBe(false)
    expect(w.chunkCount).toBe(w.loadedColumnCount)
  })
})
