/**
 * The simulation. Plain TypeScript, ticked once per frame from <GameLoop>.
 * React never holds sim state — it only reads snapshots through the UI store.
 */
import * as THREE from 'three'
import { World, type PropMeta } from '../world/chunkStore'
import { generateIsland, ISLAND_LARGE, type IslandInfo } from '../world/islandGen'
import { raycastVoxels, type RayHit } from '../world/raycast'
import { AIR, BLOCK, isProp, isSolid } from '../world/palette'
import { ChunkRenderer } from '../render/ChunkRenderer'
import { PropRenderer } from '../render/PropRenderer'
import { ViewModel } from '../render/ViewModel'
import { PlayerController, PLAYER } from '../physics/playerController'
import { Input, type InputEvent } from '../input/Input'
import { Inventory } from '../items/inventory'
import { breakTime, dropForBlock, getItem } from '../items/registry'
import { craft, getRecipe } from '../items/recipes'
import { DropManager } from '../entities/drops'
import { kindsForNight, ZombieManager, ZOMBIE, ZOMBIE_STATS, zombiesForNight, type Zombie } from '../entities/zombies'
import { ZombieRenderer, preloadZombies } from '../render/ZombieRenderer'
import { CombatFx } from '../render/CombatFx'
import { CrateManager, type LootCrate } from '../entities/crates'
import { DayNight, NIGHT_SECONDS } from './DayNight'
import { computeScore, loadBest, nightsSurvived, saveBest } from './score'
import { rayBox } from '../physics/aabb'
import { makeRng } from '../world/noise'
import { useUiStore } from '../state/uiStore'

export const REACH = 5
export type CameraMode = 'first' | 'third'
export type AnimName = 'Idle' | 'Walk' | 'Run' | 'Aim' | 'Swing'
export type Panel = 'none' | 'crafting'

const MAX_DT = 1 / 20
const SWING_SECONDS = 0.4
const THIRD_PERSON = { back: 3.5, right: 0.6, up: 1.6, clearance: 0.35 } as const
const RIFLE_MAG = 30
/** a Workbench within this distance of the player enables bench recipes */
export const BENCH_REACH = 3
const MESSAGE_SECONDS = 2.5
const RIFLE = { damage: 12, headshot: 2, interval: 0.12, reloadSeconds: 2, range: 80, kick: 0.012 } as const
const SWORD = { damage: 20, reach: 2.5, arcCos: Math.cos(Math.PI / 6), knockback: 6 } as const
const ADS = { fov: 20, normalFov: 75, speed: 12 } as const
const POISON = { seconds: 5, dps: 2 } as const
/** groups arrive during the first 70 % of the night */
const SPAWN_WINDOW = 0.7
const RESPAWN_SECONDS = 5

export class Game {
  readonly world = new World()
  readonly island: IslandInfo
  readonly chunks: ChunkRenderer
  readonly props: PropRenderer
  readonly player: PlayerController
  readonly input: Input
  readonly inventory = new Inventory()
  readonly drops: DropManager
  readonly viewModel = new ViewModel()
  readonly dayNight = new DayNight()
  readonly zombies: ZombieManager
  readonly zombieRenderer = new ZombieRenderer()
  readonly fx = new CombatFx()
  readonly crates: CrateManager
  readonly camera: THREE.PerspectiveCamera
  /** wireframe cube on the targeted block */
  readonly highlight: THREE.LineSegments
  /** light carried by the player while holding a torch */
  readonly heldLight = new THREE.PointLight(0xffb060, 8, 7, 2)
  target: RayHit | null = null
  hotbarSlot = 0
  cameraMode: CameraMode = 'first'
  /** animation the third-person body should play */
  anim: AnimName = 'Idle'
  /** rifle rounds currently loaded */
  magazine = RIFLE_MAG
  panel: Panel = 'none'
  nearWorkbench = false
  /** right mouse held with the rifle: scope view */
  aiming = false
  deaths = 0
  dead = false
  /** sim time the player comes back */
  respawnAt = 0
  crateTarget: LootCrate | null = null
  bestScore = loadBest()
  private cameraBeforeDeath: CameraMode = 'first'
  /** sim time of the last hit taken (HUD vignette) */
  hurtAt = -10
  private poisonUntil = 0
  private reloadUntil = 0
  private pendingRounds = 0
  private nextShotAt = 0
  /** sim times at which the next zombie groups spawn this night */
  private spawnTimes: number[] = []
  private message = ''
  private messageUntil = 0
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
    this.props = new PropRenderer(this.world)
    const t2 = performance.now()
    console.info(
      `island: ${this.island.voxelCount} voxels, ${this.world.chunkCount} chunks — gen ${(t1 - t0).toFixed(0)} ms, mesh ${(t2 - t1).toFixed(0)} ms`,
    )
    this.player = new PlayerController(this.world, this.island.spawn)
    this.input = new Input(canvas)
    this.drops = new DropManager(this.world)
    this.crates = new CrateManager(this.world)
    this.zombies = new ZombieManager(
      {
        world: this.world,
        damagePlayer: (amount, poison) => this.hurt(amount, poison),
        breakBlock: (x, y, z) => this.breakBlock(x, y, z, this.world.getBlock(x, y, z)),
      },
      makeRng(Date.now() & 0xffff),
    )
    preloadZombies()
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6 }),
    )
    this.highlight.visible = false
  }

  dispose(): void {
    this.input.dispose()
    this.chunks.dispose()
    this.props.dispose()
    this.drops.dispose()
    this.zombieRenderer.dispose()
    this.fx.dispose()
    this.crates.dispose()
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
    if (this.pendingRounds && this.time >= this.reloadUntil) {
      this.magazine += this.pendingRounds
      this.pendingRounds = 0
    }
    const look = this.input.takeLook()
    if (!this.dead) this.player.look(look.dx, look.dy)
    for (const ev of this.input.takeEvents()) if (!this.dead) this.handleEvent(ev)
    this.player.update(dt, this.input, this.dead)
    if (this.dead && this.time >= this.respawnAt) this.respawn()
    this.updateCombat(dt)
    this.syncCamera()
    this.updateTarget()
    this.updateBreaking(dt)
    const s = this.player.state
    this.updateNight(dt)
    this.zombies.update(dt, [{ x: s.x, y: s.y, z: s.z }])
    this.zombieRenderer.update(dt, this.zombies)
    this.fx.update(dt)
    if (this.time < this.poisonUntil) this.player.damage(POISON.dps * dt)
    if (s.health <= 0 && !this.dead) this.die()
    this.crates.update(this.time)
    const moving = Math.hypot(s.vx, s.vz) > 0.5 && s.onGround
    this.drops.update(dt, s.x, s.y, s.z, this.inventory)
    this.viewModel.setItem(this.heldItem)
    this.viewModel.update(dt, moving, this.cameraMode === 'first')
    this.updateAnim(moving)
    this.nearWorkbench = this.isNear(BLOCK.workbench, BENCH_REACH)
    this.heldLight.visible = this.heldItem === 'torch'
    this.heldLight.position.set(s.x, s.y + 1.3, s.z)
    this.chunks.update()
    this.props.update(dt, this.camera.position.x, this.camera.position.y, this.camera.position.z)
    this.publishUi()
  }

  // ---------------------------------------------------------------- night
  private updateNight(dt: number): void {
    const dn = this.dayNight
    dn.update(dt)
    if (dn.justChanged) {
      if (dn.phase === 'night') this.scheduleNight(dn.night)
      else {
        this.zombies.burnAll()
        this.spawnTimes = []
        this.showMessage(`Dawn — you survived night ${dn.night}`)
        this.bestScore = saveBest(this.score)
      }
    }
    while (this.spawnTimes.length && dn.time >= this.spawnTimes[0]) {
      this.spawnTimes.shift()
      const s = this.player.state
      this.zombies.spawnGroup(kindsForNight(dn.night), 3 + Math.floor(Math.random() * 4), [{ x: s.x, y: s.y, z: s.z }], 28)
    }
  }

  /** Split the night's zombie count into groups of 3–6 spread over the spawn window. */
  private scheduleNight(night: number): void {
    const total = zombiesForNight(night)
    const groups = Math.max(1, Math.round(total / 4.5))
    const window = NIGHT_SECONDS * SPAWN_WINDOW
    this.spawnTimes = Array.from({ length: groups }, (_, i) => this.dayNight.time + 2 + (i * window) / groups)
    this.showMessage(`Night ${night} — they are coming`)
  }

  private hurt(amount: number, poison: boolean): void {
    this.player.damage(amount)
    this.hurtAt = this.time
    if (poison) this.poisonUntil = this.time + POISON.seconds
  }

  /** seconds until the player respawns (0 when alive) */
  get respawnIn(): number {
    return this.dead ? Math.max(0, this.respawnAt - this.time) : 0
  }

  /** seconds since the player died (0 when alive) */
  get deadFor(): number {
    return this.dead ? RESPAWN_SECONDS - this.respawnIn : 0
  }

  get score(): number {
    return computeScore(this.nightsSurvived, this.zombies.kills)
  }

  get nightsSurvived(): number {
    return nightsSurvived(this.dayNight.night, this.dayNight.phase)
  }

  /** Death: the inventory becomes a loot crate where you fell; respawn after 5 s at the bed / pad. */
  private die(): void {
    this.deaths++
    this.dead = true
    this.respawnAt = this.time + RESPAWN_SECONDS
    const s = this.player.state
    this.crates.dropInventory(this.inventory, s.x, s.y + 0.5, s.z)
    this.magazine = 0
    this.pendingRounds = 0
    this.reloadUntil = 0
    this.breaking = null
    this.aiming = false
    this.poisonUntil = 0
    this.cameraBeforeDeath = this.cameraMode
    this.cameraMode = 'third'
    if (this.panel !== 'none') this.closePanel()
    this.bestScore = saveBest(this.score)
  }

  private respawn(): void {
    this.dead = false
    const sp = this.player.spawn
    this.player.teleport(sp.x, sp.y, sp.z)
    this.player.state.health = PLAYER.maxHealth
    this.player.state.stamina = PLAYER.maxStamina
    this.player.state.sinceDamage = 0
    this.cameraMode = this.cameraBeforeDeath
    this.showMessage(this.crates.crates.length ? 'Your loot crate is where you fell' : 'Back on your feet')
  }

  // ---------------------------------------------------------------- combat
  private updateCombat(dt: number): void {
    const rifle = this.heldItem === 'rifle'
    this.aiming = rifle && this.input.isButtonDown(2) && this.panel === 'none'
    const targetFov = this.aiming ? ADS.fov : ADS.normalFov
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, ADS.speed * dt)
      this.camera.updateProjectionMatrix()
    }
    // hold to fire
    if (rifle && this.input.isButtonDown(0) && this.time >= this.nextShotAt) this.fire()
  }

  /** zombies the sword can reach: within reach of the eye and inside a 60° cone */
  private swordTargets(): Zombie[] {
    const dir = this.camera.getWorldDirection(this.tmpDir)
    const s = this.player.state
    const ex = s.x
    const ey = s.y + PLAYER.eyeHeight
    const ez = s.z
    const out: Zombie[] = []
    for (const z of this.zombies.zombies) {
      if (z.state !== 'chase' && z.state !== 'attack') continue
      const dx = z.x - ex
      const dy = z.y + 1 - ey
      const dz = z.z - ez
      const d = Math.hypot(dx, dy, dz)
      if (d > SWORD.reach) continue
      const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / (d || 1)
      if (cos >= SWORD.arcCos) out.push(z)
    }
    return out
  }

  private swordAttack(): void {
    const dir = this.camera.getWorldDirection(this.tmpDir)
    for (const z of this.swordTargets()) {
      this.zombies.damage(z, SWORD.damage, dir.x * SWORD.knockback, dir.z * SWORD.knockback)
    }
  }

  /** Hitscan: nearest zombie box along the view ray, unless a block is closer. */
  private rifleHit(): { zombie: Zombie; distance: number; headshot: boolean; point: THREE.Vector3 } | null {
    const dir = this.camera.getWorldDirection(this.tmpDir).clone()
    const o = this.camera.position
    const wall = raycastVoxels(this.world, o.x, o.y, o.z, dir.x, dir.y, dir.z, RIFLE.range)
    const limit = wall ? wall.distance : RIFLE.range
    let best: Zombie | null = null
    let bestT = limit
    for (const z of this.zombies.zombies) {
      if (z.state !== 'chase' && z.state !== 'attack') continue
      const half = ZOMBIE.width / 2
      const t = rayBox(o.x, o.y, o.z, dir.x, dir.y, dir.z, { x: z.x - half, y: z.y, z: z.z - half, w: ZOMBIE.width, h: 2, d: ZOMBIE.width })
      if (t !== null && t < bestT) { best = z; bestT = t }
    }
    if (!best) return null
    const point = new THREE.Vector3(o.x + dir.x * bestT, o.y + dir.y * bestT, o.z + dir.z * bestT)
    return { zombie: best, distance: bestT, headshot: point.y > best.y + 1.5, point }
  }

  /** is a prop block of this kind within `radius` of the player's chest? */
  isNear(block: number, radius: number): boolean {
    const s = this.player.state
    for (const p of this.world.props.values()) {
      if (p.id === block && Math.hypot(p.x + 0.5 - s.x, p.y + 0.5 - (s.y + 0.9), p.z + 0.5 - s.z) <= radius) return true
    }
    return false
  }

  // ---------------------------------------------------------------- panels
  openPanel(panel: Panel): void {
    this.panel = panel
    this.input.panelOpen = true
    this.input.releaseLock()
    this.breaking = null
  }

  closePanel(): void {
    this.panel = 'none'
    this.input.panelOpen = false
    this.input.requestLock()
  }

  /** Craft a recipe from the UI; overflow that does not fit is dropped at the feet. */
  craftRecipe(recipeId: string): boolean {
    const recipe = getRecipe(recipeId)
    const result = craft(this.inventory, recipe, this.nearWorkbench)
    if (!result) return false
    if (result.overflow > 0) {
      const s = this.player.state
      this.drops.spawn(recipe.output.id, result.overflow, s.x, s.y + 1, s.z)
    }
    return true
  }

  moveSlot(from: number, to: number): void {
    if (from !== to) this.inventory.swap(from, to)
  }

  showMessage(text: string): void {
    this.message = text
    this.messageUntil = this.time + MESSAGE_SECONDS
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
      case 'inventory': this.openPanel('crafting'); break
      case 'interact': this.interact(); break
    }
  }

  /** F: use the targeted prop — bed sets the respawn point, workbench opens crafting. */
  private interact(): void {
    if (this.crateTarget) {
      const n = this.crates.loot(this.crateTarget, this.inventory)
      this.showMessage(n ? `Took ${n} item${n === 1 ? '' : 's'}` : 'Inventory full')
      return
    }
    const t = this.target
    if (!t) return
    if (t.block === BLOCK.bed) {
      this.player.spawn = { x: t.x + 0.5, y: t.y + 1, z: t.z + 0.5 }
      this.showMessage('Respawn point set')
    } else if (t.block === BLOCK.workbench) {
      this.openPanel('crafting')
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
    this.crateTarget = this.dead ? null : this.crates.targeted(ox, oy, oz, dir.x, dir.y, dir.z)
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
    if (held === 'sword') this.swordAttack()
    this.swing()
  }

  get reloading(): boolean {
    return this.time < this.reloadUntil
  }

  private fire(): void {
    if (this.reloading || this.panel !== 'none' || this.time < this.nextShotAt) return
    if (this.magazine <= 0) {
      this.reload()
      return
    }
    this.magazine--
    this.nextShotAt = this.time + RIFLE.interval
    this.swing()
    this.player.look(0, -RIFLE.kick / PLAYER.mouseSensitivity)
    const dir = this.camera.getWorldDirection(this.tmpDir)
    const o = this.camera.position
    const muzzle = new THREE.Vector3(o.x + dir.x * 0.6, o.y - 0.15, o.z + dir.z * 0.6)
    this.fx.muzzleFlash(muzzle.x, muzzle.y, muzzle.z)
    const hit = this.rifleHit()
    if (hit) {
      const dmg = RIFLE.damage * (hit.headshot ? RIFLE.headshot : 1) * ZOMBIE_STATS[hit.zombie.kind].rifleResist
      this.zombies.damage(hit.zombie, dmg, dir.x * 1.5, dir.z * 1.5)
      this.fx.tracer(muzzle, hit.point)
    } else {
      const wall = raycastVoxels(this.world, o.x, o.y, o.z, dir.x, dir.y, dir.z, RIFLE.range)
      const d = wall ? wall.distance : RIFLE.range
      this.fx.tracer(muzzle, new THREE.Vector3(o.x + dir.x * d, o.y + dir.y * d, o.z + dir.z * d))
    }
  }

  private reload(): void {
    if (this.heldItem !== 'rifle' || this.magazine === RIFLE_MAG || this.reloading) return
    const need = RIFLE_MAG - this.magazine
    const have = Math.min(need, this.inventory.count('ammo'))
    if (have <= 0) return
    this.inventory.remove('ammo', have)
    this.reloadUntil = this.time + RIFLE.reloadSeconds
    this.pendingRounds = have // loaded when the reload finishes
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
    // multi-cell props (bed) go together and drop once
    const partner = this.world.getProp(x, y, z)?.partner
    this.world.setBlock(x, y, z, AIR)
    if (partner) this.world.setBlock(partner.x, partner.y, partner.z, AIR)
    const item = dropForBlock(block)
    if (item) this.drops.spawn(item, 1, x + 0.5, y + 0.3, z + 0.5, (Math.random() - 0.5) * 2, 2.5, (Math.random() - 0.5) * 2)
  }

  private canOccupy(x: number, y: number, z: number, solid: boolean): boolean {
    const existing = this.world.getBlock(x, y, z)
    if (existing !== AIR && existing !== BLOCK.water) return false
    return !(solid && this.player.overlapsVoxel(x, y, z))
  }

  /** the player's facing snapped to a quarter turn, as a prop yaw (models face +Z at yaw 0) */
  private facingYaw(): number {
    return Math.round(this.player.state.yaw / (Math.PI / 2)) * (Math.PI / 2)
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
    if (!this.canOccupy(x, y, z, isSolid(def.block))) return
    if (isProp(def.block)) {
      if (!this.placeProp(def.block, x, y, z)) return
    } else {
      this.world.setBlock(x, y, z, def.block)
    }
    this.inventory.takeFromSlot(this.hotbarSlot, 1)
    this.swing()
  }

  /** Props need a solid floor; the bed also needs its second cell. Returns false if blocked. */
  private placeProp(block: number, x: number, y: number, z: number): boolean {
    if (!isSolid(this.world.getBlock(x, y - 1, z))) return false
    const yaw = this.facingYaw()
    const meta: PropMeta = { id: block, x, y, z, yaw, primary: true }
    if (block === BLOCK.bed) {
      const fx = x + Math.round(Math.sin(yaw))
      const fz = z + Math.round(Math.cos(yaw))
      if (!this.canOccupy(fx, y, fz, false) || !isSolid(this.world.getBlock(fx, y - 1, fz))) return false
      meta.partner = { x: fx, y, z: fz }
      this.world.setProp({ id: block, x: fx, y, z: fz, yaw, primary: false, partner: { x, y, z } })
    }
    this.world.setProp(meta)
    return true
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
      panel: this.panel,
      nearWorkbench: this.nearWorkbench,
      message: this.time < this.messageUntil ? this.message : '',
      timer: this.dayNight.timerText,
      phase: this.dayNight.phase,
      night: this.dayNight.night,
      zombies: this.zombies.liveCount,
      kills: this.zombies.kills,
      hurtAt: this.hurtAt,
      poisoned: this.time < this.poisonUntil,
      aiming: this.aiming,
      reloading: this.reloading,
      interactHint: this.crateTarget ? `F  take loot (${this.crateTarget.items.length})`
        : this.target?.block === BLOCK.bed ? 'F  set respawn'
        : this.target?.block === BLOCK.workbench ? 'F  craft' : '',
      dead: this.dead,
      respawnIn: this.respawnIn,
      score: this.score,
      bestScore: this.bestScore,
      nightsSurvived: this.nightsSurvived,
      deaths: this.deaths,
      timeAlive: this.dayNight.time,
      scoreboard: this.input.isDown('Tab'),
    })
  }
}
