/**
 * Caves and ore veins (issue #25). The properties that matter are the ones a player
 * would notice: the ground is hollow enough to explore, every mineral is actually
 * down there in its own band, and nothing about either depends on the order chunks
 * happen to be generated in.
 */
import { describe, expect, test } from 'vitest'
import { CHUNK, World } from '../chunkStore'
import { AIR, BLOCK, isSolid } from '../palette'
import { generateChunk, TerrainGenerator, WORLD_CHUNKS_Y } from '../terrainGen'
import { GROUND_MAX, PAD_BLEND, PAD_RADIUS } from '../groundGen'
import { ORES, isOre, oreOf, oresAt, depthBand, depthNote } from '../ores'
import { CAVE_FLOOR, CAVE_ROOF, CaveModel, VeinField, VEIN_CELL, VEIN_REACH, stampVeins } from '../underground'

/** block counts over a cube of chunks, by block id */
function census(seed: number, radius: number): { counts: Map<number, number>; ys: Map<number, number[]> } {
  const counts = new Map<number, number>()
  const ys = new Map<number, number[]>()
  const gen = new TerrainGenerator(seed)
  for (let cx = -radius; cx <= radius; cx++) {
    for (let cz = -radius; cz <= radius; cz++) {
      for (let cy = 0; cy < WORLD_CHUNKS_Y; cy++) {
        const data = gen.generateChunk(cx, cy, cz)
        if (!data) continue
        for (let i = 0; i < data.length; i++) {
          const id = data[i]
          if (!id) continue
          counts.set(id, (counts.get(id) ?? 0) + 1)
          if (!isOre(id)) continue
          const y = cy * CHUNK + ((i >> 4) & (CHUNK - 1))
          const list = ys.get(id)
          if (list) list.push(y)
          else ys.set(id, [y])
        }
      }
    }
  }
  return { counts, ys }
}

describe('ore table', () => {
  test('every ore has a block, a drop and a band, and no two share them', () => {
    expect(ORES.length).toBe(8)
    expect(new Set(ORES.map(o => o.block)).size).toBe(ORES.length)
    expect(new Set(ORES.map(o => o.drop)).size).toBe(ORES.length)
    for (const o of ORES) {
      expect(o.minY).toBeLessThan(o.maxY)
      expect(o.minY).toBeGreaterThanOrEqual(1) // never in the bedrock layer
      expect(o.size[0]).toBeLessThanOrEqual(o.size[1])
      expect(o.tier).toBeGreaterThanOrEqual(1)
      expect(oreOf(o.block)).toBe(o)
    }
  })

  test('the chances in any one band can never add past certain', () => {
    for (let y = 0; y <= 70; y++) {
      const total = oresAt(y).reduce((sum, o) => sum + o.chance, 0)
      expect(total).toBeLessThan(1)
    }
  })

  test('depth bands name the rock, not where the player is', () => {
    expect(depthBand(60)).toBe('high ground')
    expect(depthBand(40)).toBe('shallow rock')
    expect(depthBand(20)).toBe('deep rock')
    expect(depthBand(5)).toBe('bedrock depths')
  })

  test('the depth note measures from the surface above you, not from sea level', () => {
    // standing on the grass at y 37 is above ground, however deep that sounds
    expect(depthNote(37, 37)).toBe('above ground')
    expect(depthNote(10, 37)).toBe('27 m down')
    // on a sky island the ground is far below, so you are plainly out in the open
    expect(depthNote(90, 37)).toBe('above ground')
  })
})

describe('caves', () => {
  test('never break the roof, the bedrock floor, or the ground under the spawn pad', () => {
    const caves = new CaveModel(11, PAD_RADIUS + PAD_BLEND)
    const h = 40
    for (let y = 0; y <= h; y++) {
      // directly over the pad, at any depth
      expect(caves.open(0, y, 0, h)).toBe(false)
      expect(caves.open(PAD_RADIUS + PAD_BLEND, y, 0, h)).toBe(false)
    }
    for (let x = -60; x < 60; x += 3) {
      for (let z = -60; z < 60; z += 3) {
        for (let y = h - CAVE_ROOF + 1; y <= h; y++) expect(caves.open(x, y, z, h)).toBe(false)
        for (let y = 0; y <= CAVE_FLOOR; y++) expect(caves.open(x, y, z, h)).toBe(false)
      }
    }
  })

  test('hollow out a useful slice of the deep stone, and none of the shallow soil', () => {
    const caves = new CaveModel(7, PAD_RADIUS + PAD_BLEND)
    const h = 44
    let open = 0
    let total = 0
    for (let x = 100; x < 200; x++) {
      for (let z = 100; z < 200; z++) {
        for (let y = CAVE_FLOOR + 1; y <= h - CAVE_ROOF; y++) {
          total++
          if (caves.open(x, y, z, h)) open++
        }
      }
    }
    const fraction = open / total
    expect(fraction).toBeGreaterThan(0.01)
    expect(fraction).toBeLessThan(0.15)
  })

  test('are a pure function of the seed', () => {
    const a = new CaveModel(3, 12)
    const b = new CaveModel(3, 12)
    const other = new CaveModel(4, 12)
    let differs = 0
    for (let y = 4; y < 40; y++) {
      expect(a.open(17, y, -23, 44)).toBe(b.open(17, y, -23, 44))
      if (a.open(17, y, -23, 44) !== other.open(17, y, -23, 44)) differs++
    }
    expect(differs).toBeGreaterThan(0)
  })
})

describe('ore veins', () => {
  test('a vein is the same however you reach it, and stays inside its reach box', () => {
    const field = new VeinField(11)
    const other = new VeinField(11)
    let seen = 0
    for (let gx = -4; gx <= 4; gx++) {
      for (let gy = 0; gy <= 4; gy++) {
        for (let gz = -4; gz <= 4; gz++) {
          const v = field.in(gx, gy, gz)
          expect(v).toEqual(other.in(gx, gy, gz))
          if (!v) continue
          seen++
          expect(v.offsets.length % 3).toBe(0)
          for (let i = 0; i < v.offsets.length; i++) expect(Math.abs(v.offsets[i])).toBeLessThanOrEqual(VEIN_REACH)
          // the vein's ore must be one whose band holds its centre
          expect(v.y).toBeGreaterThanOrEqual(v.ore.minY)
          expect(v.y).toBeLessThanOrEqual(v.ore.maxY)
          // and its centre must sit in the cell that produced it
          expect(Math.floor(v.x / VEIN_CELL)).toBe(gx)
          expect(Math.floor(v.z / VEIN_CELL)).toBe(gz)
        }
      }
    }
    expect(seen).toBeGreaterThan(20)
  })

  test('different seeds put the ore in different places', () => {
    const a = new VeinField(11)
    const b = new VeinField(12)
    let differs = 0
    for (let gx = 0; gx < 8; gx++) {
      for (let gz = 0; gz < 8; gz++) {
        const va = a.in(gx, 1, gz)
        const vb = b.in(gx, 1, gz)
        if (JSON.stringify(va) !== JSON.stringify(vb)) differs++
      }
    }
    expect(differs).toBeGreaterThan(20)
  })

  test('stamping only ever replaces stone', () => {
    const field = new VeinField(11)
    const veins = field.near(0, 0, 0, CHUNK - 1, CHUNK - 1, CHUNK - 1)
    const data = new Uint8Array(CHUNK ** 3).fill(BLOCK.dirt)
    expect(stampVeins(data, veins, 0, 0, 0)).toBe(false)
    expect(data.every(b => b === BLOCK.dirt)).toBe(true)

    const stone = new Uint8Array(CHUNK ** 3).fill(BLOCK.stone)
    stampVeins(stone, veins, 0, 0, 0)
    for (const b of stone) expect(b === BLOCK.stone || isOre(b)).toBe(true)
  })
})

describe('the ground as generated', () => {
  test('holds every mineral, each one only in its own band', () => {
    const { counts, ys } = census(11, 4)
    for (const o of ORES) {
      const found = counts.get(o.block) ?? 0
      expect(found, `${o.drop} should be somewhere in the world`).toBeGreaterThan(0)
      // a vein straddles its centre, so a block may sit up to VEIN_REACH outside the band.
      // Sky-island ore (coal, iron, copper) is generated separately and sits far higher.
      const islandOre = o.block === BLOCK.ore_coal || o.block === BLOCK.ore_iron || o.block === BLOCK.ore_copper
      const underground = (ys.get(o.block) ?? []).filter(y => islandOre ? y <= GROUND_MAX : true)
      for (const y of underground) {
        expect(y, `${o.drop} at y ${y}`).toBeGreaterThanOrEqual(o.minY - VEIN_REACH)
        expect(y, `${o.drop} at y ${y}`).toBeLessThanOrEqual(o.maxY + VEIN_REACH)
      }
    }
    // the deep ones really are deeper than the shallow ones
    const median = (id: number): number => {
      const list = (ys.get(id) ?? []).filter(y => y <= GROUND_MAX).sort((a, b) => a - b)
      return list[list.length >> 1]
    }
    expect(median(BLOCK.ore_diamond)).toBeLessThan(median(BLOCK.ore_coal))
    expect(median(BLOCK.ore_redstone)).toBeLessThan(median(BLOCK.ore_iron))
  })

  test('diamond is rarer than iron, which is rarer than coal', () => {
    const { counts } = census(11, 3)
    const n = (id: number): number => counts.get(id) ?? 0
    expect(n(BLOCK.ore_diamond)).toBeLessThan(n(BLOCK.ore_iron))
    expect(n(BLOCK.ore_iron)).toBeLessThan(n(BLOCK.ore_coal))
    expect(n(BLOCK.ore_emerald)).toBeLessThan(n(BLOCK.ore_copper))
  })

  test('ore never floats in a cave or sits in the soil', () => {
    const w = new World()
    const seed = 33
    for (let cx = -2; cx < 2; cx++) {
      for (let cz = -2; cz < 2; cz++) {
        for (let cy = 0; cy < WORLD_CHUNKS_Y; cy++) {
          const data = generateChunk(seed, cx, cy, cz)
          if (!data) continue
          for (let i = 0; i < data.length; i++) {
            if (!data[i]) continue
            w.setBlock(cx * CHUNK + (i >> 8), cy * CHUNK + ((i >> 4) & 15), cz * CHUNK + (i & 15), data[i])
          }
        }
      }
    }
    let ore = 0
    let exposed = 0
    for (let x = -32; x < 32; x++) {
      for (let z = -32; z < 32; z++) {
        for (let y = 1; y < GROUND_MAX; y++) {
          const id = w.getBlock(x, y, z)
          if (!isOre(id)) continue
          ore++
          expect(isSolid(id)).toBe(true)
          // ore replaced stone, so it can only have neighbours stone could have
          if (w.getBlock(x + 1, y, z) === AIR || w.getBlock(x - 1, y, z) === AIR ||
              w.getBlock(x, y + 1, z) === AIR || w.getBlock(x, y - 1, z) === AIR ||
              w.getBlock(x, y, z + 1) === AIR || w.getBlock(x, y, z - 1) === AIR) exposed++
        }
      }
    }
    expect(ore).toBeGreaterThan(0)
    // some of it shows in a tunnel wall: that is what makes caves worth walking
    expect(exposed).toBeGreaterThan(0)
  })

  test('a saved world keeps its builds where a cave is now carved', () => {
    // Saves are seed + a diff of edits, so an old world regenerates with caves under
    // it. What a player built or dug must still win over what the generator now says.
    const seed = 21
    const gen = new TerrainGenerator(seed)
    // find a block the caves have hollowed out
    let hollow: { x: number; y: number; z: number } | null = null
    for (let cx = 0; cx < 3 && !hollow; cx++) {
      for (let cy = 0; cy < WORLD_CHUNKS_Y && !hollow; cy++) {
        const data = gen.generateChunk(cx, cy, 0)
        if (!data) continue
        for (let i = 0; i < data.length && !hollow; i++) {
          if (data[i] !== AIR) continue
          const y = cy * CHUNK + ((i >> 4) & (CHUNK - 1))
          if (y > CAVE_FLOOR && y < GROUND_MAX - CAVE_ROOF) {
            hollow = { x: cx * CHUNK + (i >> 8), y, z: i & (CHUNK - 1) }
          }
        }
      }
    }
    expect(hollow, 'the sample should contain a cave').not.toBeNull()

    const world = new World()
    world.setGenerator((cx, cy, cz) => gen.generateChunk(cx, cy, cz), WORLD_CHUNKS_Y)
    world.trackEdits = true
    // the player had walled this in before the update; the edit is all the save kept
    world.setBlock(hollow!.x, hollow!.y, hollow!.z, BLOCK.planks)
    world.loadColumn(hollow!.x >> 4, hollow!.z >> 4)
    expect(world.getBlock(hollow!.x, hollow!.y, hollow!.z)).toBe(BLOCK.planks)
  })

  test('chunks come out the same whichever order they are asked for, caves and ore included', () => {
    const forward = new TerrainGenerator(99)
    const backward = new TerrainGenerator(99)
    const coords: [number, number, number][] = []
    for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) for (let cy = 0; cy < WORLD_CHUNKS_Y; cy++) coords.push([cx, cy, cz])
    const f = coords.map(([cx, cy, cz]) => forward.generateChunk(cx, cy, cz))
    const b = coords.slice().reverse().map(([cx, cy, cz]) => backward.generateChunk(cx, cy, cz)).reverse()
    expect(f).toEqual(b)
    // and the sample really did contain ore, or the check proves nothing
    expect(f.some(d => d && d.some(id => isOre(id)))).toBe(true)
  })
})
