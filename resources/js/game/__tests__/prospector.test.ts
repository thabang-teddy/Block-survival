/**
 * The prospector's scan (issue #25): it finds the ore that is loaded and near, ignores
 * the ore that is neither, and puts the fix where the ore actually is.
 */
import { describe, expect, test } from 'vitest'
import { CHUNK, localIndex } from '../../world/chunkStore'
import { BLOCK } from '../../world/palette'
import { MAX_FIXES, scanForOre, type ChunkSource } from '../prospector'

const CHUNKS_Y = 8

/** a world of loose chunks you can poke blocks into */
class FakeChunks implements ChunkSource {
  private readonly chunks = new Map<string, Uint8Array>()

  put(x: number, y: number, z: number, id: number): this {
    const key = `${x >> 4},${y >> 4},${z >> 4}`
    let c = this.chunks.get(key)
    if (!c) {
      c = new Uint8Array(CHUNK ** 3)
      this.chunks.set(key, c)
    }
    c[localIndex(x, y, z)] = id
    return this
  }

  getChunk(cx: number, cy: number, cz: number): Uint8Array | undefined {
    return this.chunks.get(`${cx},${cy},${cz}`)
  }
}

describe('scanForOre', () => {
  test('finds nothing in an empty world', () => {
    expect(scanForOre(new FakeChunks(), BLOCK.ore_iron, 0, 40, 0, 32, CHUNKS_Y)).toEqual([])
  })

  test('points at a vein, with its size, from the player', () => {
    const w = new FakeChunks()
    for (let i = 0; i < 4; i++) w.put(20, 20 + i, 4, BLOCK.ore_iron) // all inside chunk cy 1
    const [fix, ...rest] = scanForOre(w, BLOCK.ore_iron, 0, 30, 0, 64, CHUNKS_Y)
    expect(rest).toEqual([])
    expect(fix.count).toBe(4)
    expect(fix.x).toBeCloseTo(20.5)
    expect(fix.z).toBeCloseTo(4.5)
    expect(fix.y).toBeCloseTo(22) // centre of mass of y 20..23, plus half a block
    expect(fix.distance).toBeCloseTo(Math.hypot(20.5, 8, 4.5))
  })

  test('a vein lying across a chunk border is reported as one fix per side', () => {
    // the scan aggregates per chunk, so the two halves each get a marker. They sit a
    // couple of metres apart and both walk you to the same hole, which is what matters.
    const w = new FakeChunks()
    for (let i = 0; i < 4; i++) w.put(20, 30 + i, 4, BLOCK.ore_iron) // y 30,31 | 32,33
    const fixes = scanForOre(w, BLOCK.ore_iron, 0, 30, 0, 64, CHUNKS_Y)
    expect(fixes).toHaveLength(2)
    expect(fixes.reduce((n, f) => n + f.count, 0)).toBe(4)
    expect(Math.abs(fixes[0].y - fixes[1].y)).toBeLessThan(3)
  })

  test('ignores ore it is not tuned to', () => {
    const w = new FakeChunks().put(5, 20, 5, BLOCK.ore_diamond)
    expect(scanForOre(w, BLOCK.ore_iron, 0, 20, 0, 32, CHUNKS_Y)).toEqual([])
    expect(scanForOre(w, BLOCK.ore_diamond, 0, 20, 0, 32, CHUNKS_Y)).toHaveLength(1)
  })

  test('ignores ore beyond its range', () => {
    const w = new FakeChunks().put(100, 20, 0, BLOCK.ore_gold)
    expect(scanForOre(w, BLOCK.ore_gold, 0, 20, 0, 32, CHUNKS_Y)).toEqual([])
    expect(scanForOre(w, BLOCK.ore_gold, 0, 20, 0, 128, CHUNKS_Y)).toHaveLength(1)
  })

  test('ignores ore in a chunk that has not streamed in', () => {
    // the chunk is never created, so the ore is out there but unknown — as it should be
    const w = new FakeChunks()
    expect(scanForOre(w, BLOCK.ore_coal, 0, 20, 0, 64, CHUNKS_Y)).toEqual([])
  })

  test('returns the nearest fixes first, and no more than MAX_FIXES', () => {
    const w = new FakeChunks()
    // one pocket per chunk, marching away along x
    for (let i = 1; i <= MAX_FIXES + 3; i++) w.put(i * CHUNK, 20, 0, BLOCK.ore_lapis)
    const fixes = scanForOre(w, BLOCK.ore_lapis, 0, 20, 0, 400, CHUNKS_Y)
    expect(fixes).toHaveLength(MAX_FIXES)
    for (let i = 1; i < fixes.length; i++) expect(fixes[i].distance).toBeGreaterThan(fixes[i - 1].distance)
    expect(fixes[0].x).toBeCloseTo(CHUNK + 0.5)
  })

  test('stays inside the world band however high or low the player is', () => {
    const w = new FakeChunks().put(3, 5, 3, BLOCK.ore_diamond)
    expect(scanForOre(w, BLOCK.ore_diamond, 0, 0, 0, 64, CHUNKS_Y)).toHaveLength(1)
    expect(scanForOre(w, BLOCK.ore_diamond, 0, 127, 0, 200, CHUNKS_Y)).toHaveLength(1)
  })

  test('reads the live world, so ore already dug out stops showing', () => {
    const w = new FakeChunks().put(8, 20, 8, BLOCK.ore_iron)
    expect(scanForOre(w, BLOCK.ore_iron, 0, 20, 0, 32, CHUNKS_Y)).toHaveLength(1)
    w.put(8, 20, 8, BLOCK.air)
    expect(scanForOre(w, BLOCK.ore_iron, 0, 20, 0, 32, CHUNKS_Y)).toEqual([])
  })
})
