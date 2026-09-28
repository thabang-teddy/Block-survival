/**
 * Physics + raycast fixtures for the native client (docs/flutter-client-plan.md §4):
 * the player controller, swept AABBs and the voxel raycast must behave exactly as
 * in the browser, or two clients disagree about where a player is and what they hit.
 *
 * Writes shared/fixtures/physics/:
 *   walk.json     a scripted sequence of ticks on the real seed-11 world around the
 *                 spawn pad (keys, look deltas, jumps, an updraft ride) with the full
 *                 player state after every tick
 *   raycast.json  rays from the spawn area against the same world
 *   aabb.json     moveBox cases on a hand-built world
 *
 * Regenerate with `npm run fixtures:physics` when physics/*.ts, raycast.ts or the
 * updraft rules change.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { World } from '../resources/js/world/chunkStore'
import { BLOCK } from '../resources/js/world/palette'
import { raycastVoxels } from '../resources/js/world/raycast'
import { TerrainGenerator, WORLD_CHUNKS_Y } from '../resources/js/world/terrainGen'
import { moveBox, type Box } from '../resources/js/physics/aabb'
import { PlayerController, PLAYER } from '../resources/js/physics/playerController'
import type { Input } from '../resources/js/input/Input'

const OUT = resolve(import.meta.dirname, '../../shared/fixtures/physics')
const SEED = 11
const DT = 1 / 60

function streamedWorld(radius: number): { world: World; terrain: TerrainGenerator } {
  const terrain = new TerrainGenerator(SEED)
  const world = new World()
  world.setGenerator((cx, cy, cz) => terrain.generateChunk(cx, cy, cz), WORLD_CHUNKS_Y)
  for (let cx = -radius; cx <= radius; cx++) for (let cz = -radius; cz <= radius; cz++) world.loadColumn(cx, cz)
  return { world, terrain }
}

const fakeInput = (down: string[]): Input => ({ isDown: (code: string) => down.includes(code), locked: true }) as unknown as Input

interface Step { keys: string[]; look?: [number, number]; jump?: boolean; frozen?: boolean; repeat?: number }

/** a walk around the pad: turn, walk, sprint, jump at the cliff, ride the legacy island's updraft */
function script(terrain: TerrainGenerator): Step[] {
  const shaft = terrain.updraftOf({ ix: 0, iz: 0, x: 0, z: 0, baseY: 80, params: { size: 56, seed: 11, maxHeight: 9, depth: 16, padRadius: 8, lake: true, treeDensity: 0.022 } })
  return [
    { keys: [], repeat: 30 }, // settle onto the pad
    { keys: [], look: [120, -40] },
    { keys: ['KeyW'], repeat: 90 },
    { keys: ['KeyW', 'ShiftLeft'], repeat: 120 },
    { keys: ['KeyW'], jump: true },
    { keys: ['KeyW'], repeat: 40 },
    { keys: ['KeyA'], look: [-300, 60], repeat: 30 },
    { keys: ['KeyS', 'KeyD'], repeat: 45 },
    { keys: [], frozen: true, repeat: 20 },
    { keys: ['KeyW'], look: [45, 0], repeat: 60 },
    // teleport under the shaft and ride it
    { keys: ['__teleport'], look: [0, 0] },
    { keys: ['Space'], repeat: 240 },
    { keys: [], repeat: 60 },
    { keys: ['ShiftLeft'], repeat: 60 },
    { keys: ['KeyW'], repeat: 30 },
  ].map(s => (s.keys.includes('__teleport') ? { ...s, keys: [], teleport: { x: shaft.x, y: shaft.bottomY + 0.5, z: shaft.z } } : s)) as Step[]
}

function walkFixture(): object {
  const { world, terrain } = streamedWorld(3)
  const spawn = terrain.spawn()
  const player = new PlayerController(world, spawn)
  player.updrafts = (x, z) => terrain.updraftsNear(x - 3, z - 3, x + 3, z + 3)
  const ticks: object[] = []
  const steps = script(terrain)
  for (const step of steps) {
    const s = step as Step & { teleport?: { x: number; y: number; z: number } }
    for (let i = 0; i < (s.repeat ?? 1); i++) {
      if (s.teleport && i === 0) player.teleport(s.teleport.x, s.teleport.y, s.teleport.z)
      if (s.look && i === 0) player.look(s.look[0], s.look[1])
      if (s.jump && i === 0) player.queueJump()
      player.update(DT, fakeInput(s.keys), s.frozen ?? false)
      const st = player.state
      ticks.push({
        keys: s.keys, look: i === 0 ? s.look ?? null : null, jump: i === 0 && !!s.jump, frozen: !!s.frozen,
        teleport: i === 0 ? s.teleport ?? null : null,
        state: [st.x, st.y, st.z, st.vx, st.vy, st.vz, st.yaw, st.pitch, st.onGround ? 1 : 0, st.stamina, st.sprinting ? 1 : 0, st.sinceSprint, st.inUpdraft ? 1 : 0],
      })
    }
  }
  return { seed: SEED, radius: 3, dt: DT, spawn, stateFields: ['x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'pitch', 'onGround', 'stamina', 'sprinting', 'sinceSprint', 'inUpdraft'], ticks }
}

function raycastFixture(): object {
  const { world, terrain } = streamedWorld(3)
  const spawn = terrain.spawn()
  const eye = { x: spawn.x, y: spawn.y + PLAYER.eyeHeight, z: spawn.z }
  const rays: object[] = []
  const dirs: [number, number, number][] = [
    [0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    [0.3, -0.5, -0.8], [-0.6, -0.2, 0.7], [0.1, -0.05, 1], [1, -1, 1], [0.7071, 0, -0.7071],
    [0.2, 0.9, 0.1], [0, -0.3, -0.95], [0.5, -0.1, 0.02],
  ]
  for (const origin of [eye, { x: 5.25, y: 40.5, z: -3.75 }, { x: -12.5, y: 45, z: 9.5 }, { x: 0.5, y: 100, z: 0.5 }]) {
    for (const [dx, dy, dz] of dirs) {
      for (const maxDist of [6, 40]) {
        for (const ignoreWater of [true, false]) {
          const hit = raycastVoxels(world, origin.x, origin.y, origin.z, dx, dy, dz, maxDist, ignoreWater)
          rays.push({ origin: [origin.x, origin.y, origin.z], dir: [dx, dy, dz], maxDist, ignoreWater, hit: hit ? [hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, hit.distance, hit.block] : null })
        }
      }
    }
  }
  return { seed: SEED, radius: 3, hitFields: ['x', 'y', 'z', 'nx', 'ny', 'nz', 'distance', 'block'], rays }
}

function aabbFixture(): object {
  const world = new World()
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) world.setBlock(x, 0, z, BLOCK.stone)
  world.setBlock(2, 1, 0, BLOCK.stone)
  world.setBlock(2, 2, 0, BLOCK.stone)
  world.setBlock(-3, 1, 1, BLOCK.stone)
  world.setBlock(0, 4, 0, BLOCK.planks)
  world.setBlock(4, 1, 4, BLOCK.water)
  world.setBlock(5, 1, 5, BLOCK.leaves)
  const blocks: number[][] = []
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) blocks.push([x, 0, z, BLOCK.stone])
  blocks.push([2, 1, 0, BLOCK.stone], [2, 2, 0, BLOCK.stone], [-3, 1, 1, BLOCK.stone], [0, 4, 0, BLOCK.planks], [4, 1, 4, BLOCK.water], [5, 1, 5, BLOCK.leaves])
  const cases: object[] = []
  const boxes: Box[] = [
    { x: -0.3, y: 3, z: -0.3, w: 0.6, h: 1.8, d: 0.6 },
    { x: -0.3, y: 1, z: -0.3, w: 0.6, h: 1.8, d: 0.6 },
    { x: 1.2, y: 1, z: -0.2, w: 0.6, h: 1.8, d: 0.6 },
    { x: -2.2, y: 1.0001, z: 0.7, w: 0.6, h: 1.8, d: 0.6 },
    { x: 3.7, y: 1, z: 3.7, w: 0.6, h: 1.8, d: 0.6 },
  ]
  const moves: [number, number, number][] = [[0, -5, 0], [5, 0, 0.5], [-5, 0, 0], [0, 3, 0], [0.4, -0.1, 0.4], [-1, -1, -1], [0, 0, 0], [2, 0.3, -2], [0.01, -0.01, 0.01]]
  for (const box of boxes) for (const [dx, dy, dz] of moves) {
    const r = moveBox(world, box, dx, dy, dz)
    cases.push({ box: [box.x, box.y, box.z, box.w, box.h, box.d], move: [dx, dy, dz], result: [r.box.x, r.box.y, r.box.z, r.hitX ? 1 : 0, r.hitY ? 1 : 0, r.hitZ ? 1 : 0] })
  }
  return { blocks, cases }
}

function main(): void {
  mkdirSync(OUT, { recursive: true })
  const write = (name: string, value: object): void => writeFileSync(resolve(OUT, name), JSON.stringify(value) + '\n')
  write('walk.json', walkFixture())
  write('raycast.json', raycastFixture())
  write('aabb.json', aabbFixture())
  console.log(`wrote physics fixtures to ${OUT}`)
}

main()
