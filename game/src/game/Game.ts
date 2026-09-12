/**
 * The simulation. Plain TypeScript, ticked once per frame from <GameLoop>.
 * React never holds sim state — it only reads snapshots through the UI store.
 */
import * as THREE from 'three'
import { World } from '../world/chunkStore'
import { generateIsland, ISLAND_LARGE, type IslandInfo } from '../world/islandGen'
import { raycastVoxels, type RayHit } from '../world/raycast'
import { AIR, BLOCK, isSolid } from '../world/palette'
import { ChunkRenderer } from '../render/ChunkRenderer'
import { ViewModel } from '../render/ViewModel'
import { PlayerController, PLAYER } from '../physics/playerController'
import { Input, type InputEvent } from '../input/Input'
import { Inventory } from '../items/inventory'
import { breakTime, dropForBlock, getItem } from '../items/registry'
import { DropManager } from '../entities/drops'
import { useUiStore } from '../state/uiStore'

export const REACH = 5
export type CameraMode = 'first' | 'third'
export type AnimName = 'Idle' | 'Walk' | 'Run' | 'Aim' | 'Swing'

const MAX_DT = 1 / 20
const SWING_SECONDS = 0.4
const THIRD_PERSON = { back: 3.5, right: 0.6, up: 1.6, clearance: 0.35 } as const
const RIFLE_MAG = 30

/** Phase 2 starter kit so every held item can be seen; Phase 3 replaces it with crafting. */
const STARTER_KIT: readonly [string, number][] = [
  ['pickaxe_wood', 1], ['sword', 1], ['torch', 8], ['rifle', 1], ['ammo', 90], ['planks', 32],
]

export class Game {
  readonly world = new World()
  readonly island: IslandInfo
  readonly chunks: ChunkRenderer
  readonly player: PlayerController
  readonly input: Input
  readonly inventory = new Inventory()
  readonly drops: DropManager
  readonly viewModel = new ViewModel()
  readonly camera: THREE.PerspectiveCamera
  /** wireframe cube on the targeted block */
  readonly highlight: THREE.LineSegments
  target: RayHit | null = null
  hotbarSlot = 0
  cameraMode: CameraMode = 'first'
  /** animation the third-person body should play */
  anim: AnimName = 'Idle'
  /** rifle rounds currently loaded */
  magazine = RIFLE_MAG
  private swingUntil = 0
  private time = 0
  private breaking: { x: number; y: number; z: number; progress: number } | null = null
  private readonly tmpDir = new THREE.Vector3()
  private readonly tmpRight = new THREE.Vector3()

  constructor(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera) {
    this.camera = camera
    this.camera.rotation.order = 'YXZ'
    this.camera.add(this.viewModel.group)
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
    this.drops = new DropManager(this.world)
    for (const [id, n] of STARTER_KIT) this.inventory.add(id, n)
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6 }),
    )
    this.highlight.visible = false
  }

  dispose(): void {
    this.input.dispose()
    this.chunks.dispose()
    this.drops.dispose()
    this.viewModel.dispose()
    this.camera.remove(this.viewModel.group)
    this.highlight.geometry.dispose()
  }

  get heldItem(): string | null {
    return this.inventory.get(this.hotbarSlot)?.id ?? null
  }

  update(rawDt: number): void {
    const dt = Math.min(rawDt, MAX_DT)
    this.time += dt
    const look = this.input.takeLook()
    this.player.look(look.dx, look.dy)
    for (const ev of this.input.takeEvents()) this.handleEvent(ev)
    this.player.update(dt, this.input)
    this.syncCamera()
    this.updateTarget()
    this.updateBreaking(dt)
    const s = this.player.state
    const moving = Math.hypot(s.vx, s.vz) > 0.5 && s.onGround
    this.drops.update(dt, s.x, s.y, s.z, this.inventory)
    this.viewModel.setItem(this.heldItem)
    this.viewModel.update(dt, moving, this.cameraMode === 'first')
    this.updateAnim(moving)
    this.chunks.update()
    this.publishUi()
  }

  private handleEvent(ev: InputEvent): void {
    switch (ev.type) {
      case 'jump': this.player.queueJump(); break
      case 'hotbar': this.hotbarSlot = ev.slot; this.breaking = null; break
      case 'primary': this.useItem(); break
      case 'secondary': this.place(); break
      case 'toggleCamera': this.cameraMode = this.cameraMode === 'first' ? 'third' : 'first'; break
      case 'drop': this.dropHeld(); break
      case 'reload': this.reload(); break
    }
  }

  // ---------------------------------------------------------------- camera
  private syncCamera(): void {
    const s = this.player.state
    this.camera.rotation.set(s.pitch, s.yaw, 0)
    if (this.cameraMode === 'first') {
      this.camera.position.set(s.x, s.y + PLAYER.eyeHeight, s.z)
      return
    }
    const fwd = this.camera.getWorldDirection(this.tmpDir)
    const right = this.tmpRight.set(-fwd.z, 0, fwd.x).normalize()
    const pivotX = s.x
    const pivotY = s.y + THIRD_PERSON.up
    const pivotZ = s.z
    const ox = -fwd.x * THIRD_PERSON.back + right.x * THIRD_PERSON.right
    const oy = -fwd.y * THIRD_PERSON.back
    const oz = -fwd.z * THIRD_PERSON.back + right.z * THIRD_PERSON.right
    let dist = Math.hypot(ox, oy, oz)
    const hit = raycastVoxels(this.world, pivotX, pivotY, pivotZ, ox, oy, oz, dist + THIRD_PERSON.clearance)
    if (hit) dist = Math.max(0.3, hit.distance - THIRD_PERSON.clearance)
    const k = dist / Math.hypot(ox, oy, oz)
    this.camera.position.set(pivotX + ox * k, pivotY + oy * k, pivotZ + oz * k)
  }

  private updateTarget(): void {
    const dir = this.camera.getWorldDirection(this.tmpDir)
    const s = this.player.state
    // in third person aim from the head, so blocks between camera and player are ignored
    const ox = this.cameraMode === 'first' ? this.camera.position.x : s.x
    const oy = this.cameraMode === 'first' ? this.camera.position.y : s.y + PLAYER.eyeHeight
    const oz = this.cameraMode === 'first' ? this.camera.position.z : s.z
    this.target = raycastVoxels(this.world, ox, oy, oz, dir.x, dir.y, dir.z, REACH)
    if (this.target) {
      this.highlight.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5)
      this.highlight.visible = true
    } else {
      this.highlight.visible = false
    }
  }

  private updateAnim(moving: boolean): void {
    const s = this.player.state
    if (this.time < this.swingUntil) this.anim = 'Swing'
    else if (moving && s.sprinting) this.anim = 'Run'
    else if (moving) this.anim = 'Walk'
    else if (this.heldItem === 'rifle') this.anim = 'Aim'
    else this.anim = 'Idle'
  }

  // ---------------------------------------------------------------- actions
  private swing(): void {
    this.swingUntil = this.time + SWING_SECONDS
    this.viewModel.swing()
  }

  /** Left click: weapons swing/fire; everything else starts digging (hold to continue). */
  private useItem(): void {
    const held = this.heldItem
    if (held === 'rifle') {
      this.fire()
      return
    }
    this.swing()
  }

  private fire(): void {
    if (this.magazine <= 0) {
      this.reload()
      return
    }
    this.magazine--
    this.swing()
    // hitscan damage arrives with zombies in Phase 4
  }

  private reload(): void {
    if (this.heldItem !== 'rifle' || this.magazine === RIFLE_MAG) return
    const need = RIFLE_MAG - this.magazine
    const have = Math.min(need, this.inventory.count('ammo'))
    if (have <= 0) return
    this.inventory.remove('ammo', have)
    this.magazine += have
  }

  /** Hold-to-dig: progress accumulates while the left button is held on the same block. */
  private updateBreaking(dt: number): void {
    const t = this.target
    const held = this.heldItem
    const digging = this.input.isButtonDown(0) && t && held !== 'rifle' && held !== 'sword'
    if (!digging) {
      this.breaking = null
      return
    }
    if (!this.breaking || this.breaking.x !== t.x || this.breaking.y !== t.y || this.breaking.z !== t.z) {
      this.breaking = { x: t.x, y: t.y, z: t.z, progress: 0 }
    }
    // lowest 2 layers are bedrock (indestructible), per the spec
    if (t.y <= this.world.bounds.minY + 1) return
    const seconds = breakTime(t.block, held)
    if (!Number.isFinite(seconds)) return
    this.breaking.progress += dt / seconds
    if (this.time > this.swingUntil - SWING_SECONDS * 0.5) this.swing()
    if (this.breaking.progress >= 1) {
      this.breakBlock(t.x, t.y, t.z, t.block)
      this.breaking = null
    }
  }

  private breakBlock(x: number, y: number, z: number, block: number): void {
    this.world.setBlock(x, y, z, AIR)
    const item = dropForBlock(block)
    if (item) this.drops.spawn(item, 1, x + 0.5, y + 0.3, z + 0.5, (Math.random() - 0.5) * 2, 2.5, (Math.random() - 0.5) * 2)
  }

  place(): void {
    const t = this.target
    const stack = this.inventory.get(this.hotbarSlot)
    if (!t || !stack || (t.nx === 0 && t.ny === 0 && t.nz === 0)) return
    const def = getItem(stack.id)
    if (def.block === undefined) return
    const x = t.x + t.nx
    const y = t.y + t.ny
    const z = t.z + t.nz
    const existing = this.world.getBlock(x, y, z)
    if (existing !== AIR && existing !== BLOCK.water) return
    if (isSolid(def.block) && this.player.overlapsVoxel(x, y, z)) return
    if (this.inventory.takeFromSlot(this.hotbarSlot, 1) !== 1) return
    this.world.setBlock(x, y, z, def.block)
    this.swing()
  }

  private dropHeld(): void {
    const stack = this.inventory.get(this.hotbarSlot)
    if (!stack) return
    const n = this.inventory.takeFromSlot(this.hotbarSlot, 1)
    if (n !== 1) return
    const s = this.player.state
    const dir = this.camera.getWorldDirection(this.tmpDir)
    this.drops.spawn(stack.id, 1, s.x + dir.x * 0.6, s.y + 1.3, s.z + dir.z * 0.6, dir.x * 4, 2.5, dir.z * 4)
  }

  // ---------------------------------------------------------------- ui
  private publishUi(): void {
    const s = this.player.state
    const held = this.heldItem
    useUiStore.getState().sync({
      locked: this.input.locked,
      hotbarSlot: this.hotbarSlot,
      inventoryVersion: this.inventory.version,
      hotbar: this.inventory.hotbar(),
      targetBlock: this.target?.block ?? AIR,
      position: [s.x, s.y, s.z],
      health: s.health,
      stamina: s.stamina,
      ammo: held === 'rifle' ? { mag: this.magazine, reserve: this.inventory.count('ammo') } : null,
      cameraMode: this.cameraMode,
      breakProgress: this.breaking?.progress ?? 0,
      canBreak: this.target ? Number.isFinite(breakTime(this.target.block, held)) : true,
    })
  }
}
