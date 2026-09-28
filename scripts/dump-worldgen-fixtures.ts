/**
 * Golden world-generation fixtures for the native client (docs/flutter-client-plan.md §2 S2).
 *
 * Runs the TypeScript generator for a handful of seeds and writes what the Dart port
 * must reproduce byte for byte into shared/fixtures/worldgen/:
 *
 *   primitives.json   samples of the building blocks (mulberry32, hashInt, Perlin,
 *                     fractal2, Math.hypot / sin / cos as V8 computes them) so a
 *                     mismatch is pinned to one function instead of a whole chunk
 *   seed-<n>.json     per seed: spawn, ground heights, tree heights, island placement,
 *                     island template bounds + hashes, updrafts, and full chunk contents
 *                     (gzip + base64) for a set of chunk coordinates
 *   manifest.json     what was written and the list of seeds
 *
 * Any change to resources/js/world/*.ts must re-run this (`npm run fixtures:worldgen`)
 * and commit the result in the same PR; client/ tests fail on drift.
 */
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CHUNK } from '../resources/js/world/chunkStore'
import { createRng, fractal2, hashInt, PerlinNoise } from '../resources/js/world/noise'
import { GroundModel } from '../resources/js/world/groundGen'
import { islandAtCell, islandsNear, IslandTemplates } from '../resources/js/world/islandField'
import { ISLAND_LARGE } from '../resources/js/world/islandGen'
import { IslandTemplate } from '../resources/js/world/islandTemplate'
import { TerrainGenerator, WORLD_CHUNKS_Y } from '../resources/js/world/terrainGen'
import { PAD_BLEND, PAD_RADIUS } from '../resources/js/world/groundGen'
import { CaveModel, VeinField } from '../resources/js/world/underground'

/** 2: caves and ore veins under the ground (issue #25) changed every chunk */
export const FIXTURE_VERSION = 2
/** the global world's seed plus a spread of own-world seeds (31-bit, like newWorldSeed) */
export const SEEDS = [ISLAND_LARGE.seed, 1, 12345, 987654321, 2147483646]

const OUT = resolve(import.meta.dirname, '../../shared/fixtures/worldgen')

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const packChunk = (data: Uint8Array | null): string | null => (data ? gzipSync(data).toString('base64') : null)

function primitives(): object {
  const rng: Record<string, number[]> = {}
  for (const seed of [0, 1, 11, 12345, 0xffffffff, 2147483646]) {
    const next = createRng(seed)
    rng[seed] = Array.from({ length: 8 }, next)
  }

  const hashCases: number[][] = []
  for (const [a, b, c, d] of [[0, 0, 0, 0], [1, 0, 0, 0], [11, 3, -7, 101], [12345, -1, -1, 8], [2147483646, 1000000, -1000000, 9], [-5, 2, 3, 4], [987654321, 0, 0, 0]]) {
    hashCases.push([a, b, c, d, hashInt(a, b, c, d)])
  }

  const perlin = new PerlinNoise(11 ^ 0x5eed)
  const perlinSamples: number[][] = []
  const points = [[0.5, 0.5, 0.5], [1.25, -3.75, 80.41], [-17.3, 2.9, 0.0], [1000.7, -999.1, 12.3], [0.011 * 37, 0.011 * -91, 22 * 7.31], [66000000000.5, 3.2, -1.1]]
  for (const [x, y, z] of points) perlinSamples.push([x, y, z, perlin.noise(x, y, z)])

  const n2 = fractal2(perlin)
  const fractalSamples: number[][] = []
  for (const [x, z, seed, freq] of [[0, 0, 22, 0.011], [37, -91, 22, 0.045], [-5, 3, 24, 0.02], [12, 12, 11, 0.09], [-28, 27, 12, 0.16], [3, -3, 13, 0.13], [10, 10, 14, 0.3]]) {
    fractalSamples.push([x, z, seed, freq, n2(x, z, seed, freq)])
  }

  const hypot: number[][] = []
  for (const [x, z] of [[0, 0], [3, 4], [3, 7], [5, 12], [-23, 6], [1, 1], [11, -11], [28, 1], [2, 27], [-9, -10], [8, 0], [7, 24], [-3, 8]]) {
    hypot.push([x, z, Math.hypot(x, z)])
  }

  const trig: number[][] = []
  const angles: number[] = [0, 0.1, Math.PI / 4, Math.PI / 2, 1, 2, 2.5, 3, Math.PI, 3.5, 4, 4.7, 5, 5.5, 6, 2 * Math.PI, 7, 10, 100]
  const r = createRng(0xc0ffee)
  for (let i = 0; i < 24; i++) angles.push(r() * Math.PI * 2)
  for (const a of angles) trig.push([a, Math.sin(a), Math.cos(a)])

  return { rng, hashInt: hashCases, perlin: { seed: 11 ^ 0x5eed, samples: perlinSamples }, fractal2: fractalSamples, hypot, trig }
}

/**
 * Caves and ore veins (issue #25), sampled on their own so a Dart mismatch lands on
 * one function instead of a whole chunk. Cave cases cover the roof, the bedrock floor
 * and the solid ground under the spawn pad as well as ordinary deep stone; vein cases
 * cover empty cells, shallow cells and cells down where diamond lives.
 */
function underground(seed: number): object {
  const caves = new CaveModel(seed, PAD_RADIUS + PAD_BLEND)
  const caveSamples: (number | boolean)[][] = []
  const caveCases: number[][] = [
    [0, 20, 0, 40], [6, 20, 0, 40], [12, 20, 0, 40], [13, 20, 0, 40], // over and beside the pad
    [120, 1, 64, 40], [120, 2, 64, 40], [120, 3, 64, 40], // the bedrock floor
    [64, 36, 64, 40], [64, 35, 64, 40], [64, 34, 64, 40], // the roof
    [100, 8, -100, 44], [101, 8, -100, 44], [-250, 17, 900, 48], [33, 25, -77, 52],
  ]
  for (const [x, y, z, h] of caveCases) caveSamples.push([x, y, z, h, caves.open(x, y, z, h)])

  const field = new VeinField(seed)
  const veinSamples: object[] = []
  for (let gx = -2; gx <= 2; gx++) {
    for (const gy of [0, 1, 2, 4, 6]) {
      for (let gz = -2; gz <= 2; gz++) {
        const v = field.in(gx, gy, gz)
        veinSamples.push({ gx, gy, gz, vein: v ? { block: v.ore.block, x: v.x, y: v.y, z: v.z, offsets: Array.from(v.offsets) } : null })
      }
    }
  }
  return { caves: caveSamples, veins: veinSamples }
}

function templateInfo(t: IslandTemplate, size: number, depth: number, maxHeight: number): object {
  // re-read the template through its public accessor so the hash covers exactly what stamping sees
  const ext = Math.trunc(size / 2) + 5
  const yLo = -(depth + 12)
  const yHi = maxHeight + 16
  const bytes = new Uint8Array((ext * 2 + 1) * (yHi - yLo + 1) * (ext * 2 + 1))
  let i = 0
  for (let z = -ext; z <= ext; z++) for (let y = yLo; y <= yHi; y++) for (let x = -ext; x <= ext; x++) bytes[i++] = t.get(x, y, z)
  return {
    minX: t.minX, minY: t.minY, minZ: t.minZ, maxX: t.maxX, maxY: t.maxY, maxZ: t.maxZ,
    padHeight: t.padHeight, voxelCount: t.voxelCount, sha256: sha256(bytes),
  }
}

function seedFixture(seed: number): object {
  const gen = new TerrainGenerator(seed)
  const ground = new GroundModel(seed)
  const templates = new IslandTemplates()

  const heights: number[][] = []
  const naturalHeights: number[][] = []
  for (const [x, z] of [[0, 0], [8, 0], [9, 0], [12, 0], [13, 0], [-7, 7], [40, -40], [-100, 250], [1000, 1000], [-1, -1], [16, 16], [33, -2], [-17, 0], [5, 11]]) {
    heights.push([x, z, ground.height(x, z)])
    naturalHeights.push([x, z, ground.naturalHeight(x, z)])
  }

  // every tree rooted in a 128×128 block square around the origin (root x, z, trunk height)
  const trees: number[][] = []
  const heightAt = (x: number, z: number): number => ground.height(x, z)
  for (let x = -64; x < 64; x++) for (let z = -64; z < 64; z++) {
    const h = ground.treeHeight(x, z, heightAt)
    if (h) trees.push([x, z, h])
  }

  // island cells around the origin, plus the templates and updrafts of the ones that exist
  const islands: object[] = []
  const templateInfos: object[] = []
  const updrafts: object[] = []
  let extra: { cx: number; cz: number } | null = null
  for (let ix = -2; ix <= 2; ix++) for (let iz = -2; iz <= 2; iz++) {
    const island = islandAtCell(seed, ix, iz)
    islands.push({ ix, iz, island })
    if (!island) continue
    const t = templates.get(island)
    templateInfos.push({ ix, iz, ...templateInfo(t, island.params.size, island.params.depth, island.params.maxHeight) })
    updrafts.push(gen.updraftOf(island))
    // the first generated (non-legacy) island: its centre column gets dumped at island height
    if (!extra && (ix || iz)) extra = { cx: Math.floor(island.x / CHUNK), cz: Math.floor(island.z / CHUNK) }
  }

  const coords: [number, number, number][] = []
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    for (let cy = 0; cy < WORLD_CHUNKS_Y; cy++) coords.push([cx, cy, cz])
  }
  // legacy island rim + a far ground column
  for (const [cx, cz] of [[-3, 0], [2, 1], [7, -5]]) for (const cy of [2, 4, 5, 6]) coords.push([cx, cy, cz])
  if (extra) for (const cy of [4, 5, 6, 7]) coords.push([extra.cx, cy, extra.cz])

  const chunks = coords.map(([cx, cy, cz]) => {
    const data = gen.generateChunk(cx, cy, cz)
    return { cx, cy, cz, sha256: data ? sha256(data) : null, data: packChunk(data) }
  })

  return {
    seed,
    spawn: gen.spawn(),
    padHeight: ground.padHeight,
    heights,
    naturalHeights,
    trees,
    islands,
    templates: templateInfos,
    updrafts,
    updraftsNear: gen.updraftsNear(-160, -160, 159, 159),
    islandsNear: islandsNear(seed, -100, -100, 100, 100).map(i => [i.ix, i.iz]),
    underground: underground(seed),
    chunks,
  }
}

function main(): void {
  mkdirSync(OUT, { recursive: true })
  const write = (name: string, value: object): void => writeFileSync(resolve(OUT, name), JSON.stringify(value, null, 1) + '\n')
  write('primitives.json', primitives())
  for (const seed of SEEDS) write(`seed-${seed}.json`, seedFixture(seed))
  write('manifest.json', {
    version: FIXTURE_VERSION,
    chunk: CHUNK,
    worldChunksY: WORLD_CHUNKS_Y,
    seeds: SEEDS,
    files: ['primitives.json', ...SEEDS.map(s => `seed-${s}.json`)],
    chunkEncoding: 'base64(gzip(Uint8Array of CHUNK^3 block ids, index = (x << 8) | (y << 4) | z)); null = all air',
    generator: 'server/scripts/dump-worldgen-fixtures.ts',
  })
  console.log(`wrote fixtures for seeds ${SEEDS.join(', ')} to ${OUT}`)
}

main()
