/**
 * The simulation. Plain TypeScript, ticked once per frame from <GameLoop>.
 * React never holds sim state — it only reads snapshots through the UI store.
 */
import * as THREE from 'three'
import { World } from '../world/chunkStore'
import { generateIsland, ISLAND_LARGE, type IslandInfo } from '../world/islandGen'
import { raycastVoxels, type RayHit } from '../world/raycast'
import { AIR, BLOCK, isSolid, type BlockId } from '../world/palette'
import { ChunkRenderer } from '../render/ChunkRenderer'
import { PlayerController, PLAYER } from '../physics/playerController'
import { Input } from '../input/Input'
import { useUiStore } from '../state/uiStore'

export const REACH = 5

/** Phase 1 hotbar: any block, no inventory yet. */
export const HOTBAR: readonly BlockId[] = [
  BLOCK.grass, BLOCK.dirt, BLOCK.stone, BLOCK.cobble, BLOCK.planks,
  BLOCK.log, BLOCK.leaves, BLOCK.glass, BLOCK.sand,
]

const MAX_DT = 1 / 20

export class Game {
  readonly world = new World()
  readonly island: IslandInfo
  readonly chunks: ChunkRenderer
  readonly player: PlayerController
  readonly input: Input
  readonly camera: THREE.PerspectiveCamera
  /** wireframe cube on the targeted block */
  readonly highlight: THREE.LineSegments
  target: RayHit | null = null
  hotbarSlot = 0

  constructor(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera) {
    this.camera = camera
    this.camera.rotation.order = 'YXZ'
    const t0 = performance.now()
    this.island = generateIsland(this.world, ISLAND_LARGE)
    const t1 = performance.now()
    this.chunks = new ChunkRenderer(this.world)
    this.chunks.buildAll()
    const t2 = performance.now()
    console.info(
      `island: ${this.island.voxelCount} voxels, ${this.world.chunkCount} chunks — gen ${(t1 - t0).toFixed(0)} ms, mesh ${(t2 - t1).toFixed(0)} ms`,
    )
    this.player = new PlayerController(this.world, this.island.spawn)
    this.input = new Input(canvas)
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6 }),
    )
    this.highlight.visible = false
  }

  dispose(): void {
    this.input.dispose()
    this.chunks.dispose()
    this.highlight.geometry.dispose()
  }

  update(rawDt: number): void {
    const dt = Math.min(rawDt, MAX_DT)
    const look = this.input.takeLook()
    this.player.look(look.dx, look.dy)
    for (const ev of this.input.takeEvents()) this.handleEvent(ev)
    this.player.update(dt, this.input)
    this.syncCamera()
    this.updateTarget()
    this.chunks.update()
    this.publishUi()
  }

  private handleEvent(ev: ReturnType<Input['takeEvents']>[number]): void {
    switch (ev.type) {
      case 'jump': this.player.queueJump(); break
      case 'hotbar': this.hotbarSlot = ev.slot; break
      case 'primary': this.dig(); break
      case 'secondary': this.place(); break
    }
  }

  private syncCamera(): void {
    const s = this.player.state
    this.camera.position.set(s.x, s.y + PLAYER.eyeHeight, s.z)
    this.camera.rotation.set(s.pitch, s.yaw, 0)
  }

  private updateTarget(): void {
    const dir = this.camera.getWorldDirection(new THREE.Vector3())
    const p = this.camera.position
    this.target = raycastVoxels(this.world, p.x, p.y, p.z, dir.x, dir.y, dir.z, REACH)
    if (this.target) {
      this.highlight.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5)
      this.highlight.visible = true
    } else {
      this.highlight.visible = false
    }
  }

  dig(): void {
    const t = this.target
    if (!t) return
    // lowest 2 layers are bedrock (indestructible), per the spec
    if (t.y <= this.world.bounds.minY + 1) return
    this.world.setBlock(t.x, t.y, t.z, AIR)
  }

  place(): void {
    const t = this.target
    if (!t || (t.nx === 0 && t.ny === 0 && t.nz === 0)) return
    const x = t.x + t.nx
    const y = t.y + t.ny
    const z = t.z + t.nz
    const id = HOTBAR[this.hotbarSlot]
    if (this.world.getBlock(x, y, z) !== AIR && this.world.getBlock(x, y, z) !== BLOCK.water) return
    if (isSolid(id) && this.player.overlapsVoxel(x, y, z)) return
    this.world.setBlock(x, y, z, id)
  }

  private publishUi(): void {
    const s = this.player.state
    useUiStore.getState().sync({
      locked: this.input.locked,
      hotbarSlot: this.hotbarSlot,
      targetBlock: this.target?.block ?? AIR,
      position: [s.x, s.y, s.z],
    })
  }
}
