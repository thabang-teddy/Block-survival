/**
 * This player's view of a game the server runs. Plain TypeScript, ticked once per
 * frame from <GameLoop>.
 *
 * The server (sim/HostSim.ts) is the authority for world edits, zombies, drops, crates,
 * the clock and all damage. The browser moves its own player locally, sends inputs and
 * action requests as ClientMessages, and mirrors everything else from the server's
 * snapshots, block edits and private state. React never holds sim state — it only
 * reads snapshots through the UI store.
 */
import * as THREE from 'three'
import { World } from '../world/chunkStore'
import type { WorldKind } from '../world/seed'
import { TerrainGenerator, WORLD_CHUNKS_Y } from '../world/terrainGen'
import { ChunkStreamer } from '../world/chunkStreamer'
import { raycastVoxels, type RayHit } from '../world/raycast'
import { AIR, BLOCK } from '../world/palette'
import { ChunkRenderer } from '../render/ChunkRenderer'
import { PropRenderer } from '../render/PropRenderer'
import { UpdraftRenderer } from '../render/UpdraftRenderer'
import { DropRenderer } from '../render/DropRenderer'
import { CrateRenderer } from '../render/CrateRenderer'
import { ViewModel } from '../render/ViewModel'
import { ZombieRenderer, preloadZombies } from '../render/ZombieRenderer'
import { RemotePlayerRenderer } from '../render/RemotePlayerRenderer'
import { CombatFx } from '../render/CombatFx'
import { PlayerController, PLAYER } from '../physics/playerController'
import { Input, type InputEvent } from '../input/Input'
import { breakTime, getItem } from '../items/registry'
import { DropManager } from '../entities/drops'
import { CrateManager, type LootCrate } from '../entities/crates'
import { ZombieManager } from '../entities/zombies'
import { makeRng } from '../world/noise'
import { Avatar, type AnimName, type Spawn } from './Avatar'
import { DayNight } from './DayNight'
import { currentRules, parseRules, type GameRules } from './rules'
import { computeScore, loadBest, nightsSurvived, saveBest } from './score'
import type { ClientSession } from '../net/ClientSession'
import type { BlockEdit, ClientMessage, PlayerSnap, PrivateState } from '../net/protocol'
import { api } from '../net/api'
import { projectMarker, whereOf } from './locator'
import { scanForOre, type OreFix } from './prospector'
import { ORES } from '../world/ores'
import { useUiStore, type OreMarker, type PlayerMarker } from '../state/uiStore'

export const REACH = 5
export type CameraMode = 'first' | 'third'
export type { AnimName } from './Avatar'
export type Panel = 'none' | 'crafting'
/** `host` is the world's owner (they can invite and save); the server runs it either way */
export type Role = 'host' | 'client'

const MAX_DT = 1 / 20
/** an on-screen marker is dropped this close: the name label over the player takes over */
const MARKER_NEAR_M = 12
/** markers float this far above the feet */
const MARKER_HEAD_M = PLAYER.height + 0.4
const SWING_SECONDS = 0.4
const THIRD_PERSON = { back: 3.5, right: 0.6, up: 1.6, clearance: 0.35 } as const
/** a Workbench within this distance of the player enables bench recipes */
export const BENCH_REACH = 3
const MESSAGE_SECONDS = 2.5
/** the rifle as the shooter feels it; the server decides the hits */
const RIFLE = { interval: 0.12, reloadSeconds: 2, range: 80, kick: 0.012 } as const
/** a sword swings at zombies instead of digging */
const isSword = (item: string | null): boolean => item === 'sword' || item === 'sword_diamond'
const ADS = { fov: 20, normalFov: 75, speed: 12 } as const
const POISON = { seconds: 5 } as const
const RESPAWN_SECONDS = 5
/** columns loaded synchronously around the spawn before the first frame */
const INITIAL_LOAD_RADIUS = 2
/**
 * The prospector rescans this often while it is in hand (issue #25). A scan walks every
 * loaded chunk in range, so it is worth a few milliseconds a second but not a frame's
 * worth; a wider lens costs proportionally more chunks, so it looks proportionally less
 * often. Nothing about the scan is networked — each player's lens is their own.
 */
const PROSPECT_INTERVAL = 0.4
/** an ore marker is dropped this close: you are standing on the vein */
const ORE_MARKER_NEAR_M = 4

export interface GameOptions {
  name: string
  /** connected and welcomed */
  session: ClientSession
  worldKind: WorldKind
  /** the player's own world: they can invite and save */
  owner: boolean
}

type Ray = { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }

export class Game {
  readonly role: Role
  readonly seed: number
  /** which world this is: the player's own, or the shared global one */
  readonly worldKind: WorldKind
  readonly world = new World()
  readonly terrain: TerrainGenerator
  readonly streamer: ChunkStreamer
  readonly chunks: ChunkRenderer
  readonly props: PropRenderer
  readonly updrafts: UpdraftRenderer
  readonly player: PlayerController
  readonly input: Input
  readonly drops: DropManager
  readonly crates: CrateManager
  readonly zombies: ZombieManager
  readonly dropRenderer = new DropRenderer()
  readonly crateRenderer = new CrateRenderer()
  readonly zombieRenderer = new ZombieRenderer()
  readonly remotePlayers = new RemotePlayerRenderer()
  readonly viewModel = new ViewModel()
  readonly rules: GameRules
  readonly dayNight: DayNight
  readonly fx = new CombatFx()
  readonly camera: THREE.PerspectiveCamera
  /** wireframe cube on the targeted block */
  readonly highlight: THREE.LineSegments
  /** light carried by the player while holding a torch */
  readonly heldLight = new THREE.PointLight(0xffb060, 8, 7, 2)
  readonly session: ClientSession
  readonly local: Avatar
  target: RayHit | null = null
  crateTarget: LootCrate | null = null
  cameraMode: CameraMode = 'first'
  /** animation the third-person body should play */
  anim: AnimName = 'Idle'
  panel: Panel = 'none'
  nearWorkbench = false
  /** right mouse held with the rifle: scope view */
  aiming = false
  bestScore = loadBest()
  /** poses of the other players, for the renderer and the scoreboard */
  readonly remotePoses = new Map<string, PlayerSnap>()
  private cameraBeforeDeath: CameraMode = 'first'
  private message = ''
  private messageUntil = 0
  private swingUntil = 0
  private time = 0
  private breaking: { x: number; y: number; z: number; progress: number } | null = null
  /** the phase of the server's clock last frame, to notice dawn */
  private lastPhase: DayNight['phase']
  /** which ore the prospector is tuned to, and the last scan (issue #25; purely local) */
  private prospectOre = ORES[0].block
  private oreFixes: OreFix[] = []
  private nextProspectAt = 0
  private readonly tmpDir = new THREE.Vector3()
  private readonly tmpRight = new THREE.Vector3()
  private readonly tmpViewProj = new THREE.Matrix4()

  get inventory() { return this.local.inventory }
  get hotbarSlot(): number { return this.local.slot }
  set hotbarSlot(v: number) { this.local.slot = v }
  get magazine(): number { return this.local.magazine }
  get dead(): boolean { return this.local.dead }
  get deaths(): number { return this.local.deaths }
  get hurtAt(): number { return this.local.hurtAt }
  get heldItem(): string | null { return this.local.heldItem }
  /** the world's owner, who can invite players and ask for a save */
  get isHost(): boolean { return this.role === 'host' }

  constructor(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera, opts: GameOptions) {
    const welcome = opts.session.welcome
    if (!welcome) throw new Error('The game starts after the server has welcomed us')
    this.role = opts.owner ? 'host' : 'client'
    this.session = opts.session
    this.worldKind = opts.worldKind
    // the room's rules come with the welcome, so a match runs on one set whatever the admin changes meanwhile
    this.rules = welcome.rules ? parseRules(welcome.rules) : currentRules()
    this.dayNight = new DayNight(this.rules)
    this.camera = camera
    this.camera.rotation.order = 'YXZ'
    this.camera.add(this.viewModel.group)
    const t0 = performance.now()
    this.seed = welcome.seed
    this.terrain = new TerrainGenerator(this.seed)
    this.world.setGenerator((cx, cy, cz) => this.terrain.generateChunk(cx, cy, cz), WORLD_CHUNKS_Y)
    this.applyBlockEdits(welcome.edits)
    this.dayNight.time = welcome.time
    this.dayNight.update(0)
    this.lastPhase = this.dayNight.phase
    const spawn: Spawn = welcome.spawn
    // enough ground under the player to stand on; the rest streams in over the next frames
    this.streamer = new ChunkStreamer(this.world)
    this.streamer.loadNow(spawn.x, spawn.z, INITIAL_LOAD_RADIUS)
    const t1 = performance.now()
    this.chunks = new ChunkRenderer(this.world)
    this.chunks.flush()
    this.props = new PropRenderer(this.world)
    this.updrafts = new UpdraftRenderer(this.terrain)
    const t2 = performance.now()
    console.info(
      `world seed ${this.seed}: ${this.world.loadedColumnCount} columns, ${this.world.chunkCount} chunks — gen ${(t1 - t0).toFixed(0)} ms, mesh ${(t2 - t1).toFixed(0)} ms`,
    )
    this.local = new Avatar(welcome.you, opts.name, spawn)
    this.local.userId = api.user?.id ?? null
    this.player = new PlayerController(this.world, spawn)
    if (welcome.look) {
      this.player.state.yaw = welcome.look.yaw
      this.player.state.pitch = welcome.look.pitch
    }
    this.player.updrafts = (x, z) => this.terrain.updraftsNear(x - 3, z - 3, x + 3, z + 3)
    this.input = new Input(canvas)
    this.drops = new DropManager(this.world)
    this.crates = new CrateManager(this.world)
    // a mirror of the server's zombies, for the renderer and the HUD: nothing here moves or hurts them
    this.zombies = new ZombieManager({ world: this.world, damagePlayer: () => {}, breakBlock: () => {} }, makeRng(0))
    preloadZombies()
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6 }),
    )
    this.highlight.visible = false
    opts.session.attach(this)
  }

  dispose(): void {
    this.input.dispose()
    this.chunks.dispose()
    this.props.dispose()
    this.updrafts.dispose()
    this.dropRenderer.dispose()
    this.crateRenderer.dispose()
    this.zombieRenderer.dispose()
    this.remotePlayers.dispose()
    this.fx.dispose()
    this.viewModel.dispose()
    this.camera.remove(this.viewModel.group)
    this.highlight.geometry.dispose()
    this.session.dispose()
  }

  // ================================================================ frame
  update(rawDt: number): void {
    const dt = Math.min(rawDt, MAX_DT)
    this.time += dt
    const look = this.input.takeLook()
    if (!this.dead) this.player.look(look.dx, look.dy)
    this.reportLookSpikes()
    for (const ev of this.input.takeEvents()) if (!this.dead) this.handleEvent(ev)
    // never integrate physics over ground that has not streamed in yet (e.g. right after a teleport)
    const p = this.player.state
    if (this.world.isColumnLoaded(Math.floor(p.x), Math.floor(p.z))) this.player.update(dt, this.input, this.dead)
    this.mirrorLocalPose()
    this.updateAiming(dt)
    this.syncCamera()
    this.updateTarget()
    this.updateBreaking(dt)
    this.mirrorServer(dt)

    const s = this.player.state
    const moving = Math.hypot(s.vx, s.vz) > 0.5 && s.onGround
    this.viewModel.setItem(this.heldItem)
    this.viewModel.update(dt, moving, this.cameraMode === 'first' && !this.dead)
    this.updateAnim(moving)
    this.nearWorkbench = this.isNear(BLOCK.workbench, BENCH_REACH)
    this.heldLight.visible = this.heldItem === 'torch' && !this.dead
    this.heldLight.position.set(s.x, s.y + 1.3, s.z)
    this.streamer.update([this.local], [])
    this.chunks.update()
    this.props.update(dt, this.camera.position.x, this.camera.position.y, this.camera.position.z)
    this.updrafts.update(dt, this.camera.position.x, this.camera.position.z)
    this.dropRenderer.update(this.drops.drops, this.time)
    this.crateRenderer.update(this.crates.crates, this.time)
    this.zombieRenderer.update(dt, this.zombies)
    this.remotePlayers.update(dt, this.remotePoses.values())
    this.fx.update(dt)
    this.updateProspector()
    this.publishUi()
    this.publishMarkers()
    this.publishOreMarkers()
  }

  private mirrorLocalPose(): void {
    const s = this.player.state
    const a = this.local
    a.x = s.x; a.y = s.y; a.z = s.z; a.yaw = s.yaw; a.pitch = s.pitch
    a.anim = this.anim
    a.aiming = this.aiming
  }

  // ---------------------------------------------------------------- the server's world
  /** Send this frame's input, and mirror the other players, the zombies, drops, crates and the clock from snapshots. */
  private mirrorServer(dt: number): void {
    this.session.tick(dt)
    const now = performance.now() / 1000
    const sample = this.session.buffer.sample(now)
    if (!sample) return
    this.dayNight.time = this.session.buffer.hostTime(now)
    this.dayNight.update(0)
    // dawn: the night just survived counts towards this browser's best
    if (this.lastPhase === 'night' && this.dayNight.phase === 'day') this.bestScore = saveBest(this.score)
    this.lastPhase = this.dayNight.phase
    this.remotePoses.clear()
    for (const p of sample.players) {
      if (p.id === this.local.id) { this.local.kills = p.kills; this.local.deaths = p.deaths; continue }
      this.remotePoses.set(p.id, p)
    }
    // mirror zombies into the manager's list so the renderer and HUD see them
    const list = this.zombies.zombies
    const seen = new Set<number>()
    for (const zs of sample.zombies) {
      seen.add(zs.id)
      let z = list.find(x => x.id === zs.id)
      if (!z) {
        z = {
          id: zs.id, kind: zs.kind, x: zs.x, y: zs.y, z: zs.z, vx: 0, vy: 0, vz: 0, yaw: zs.yaw, hp: 1, onGround: true,
          state: zs.state, burnTimer: zs.burnTimer, path: [], repathIn: 0, attackCooldown: 0, stuckTime: 0, attacked: false,
        }
        list.push(z)
      }
      z.vx = (zs.x - z.x) / Math.max(dt, 1e-3)
      z.vz = (zs.z - z.z) / Math.max(dt, 1e-3)
      z.x = zs.x; z.y = zs.y; z.z = zs.z; z.yaw = zs.yaw
      z.state = zs.state; z.burnTimer = zs.burnTimer; z.attacked = zs.attacked
    }
    for (let i = list.length - 1; i >= 0; i--) if (!seen.has(list[i].id)) list.splice(i, 1)
    this.drops.applySnapshot(sample.drops)
    this.crates.applySnapshot(sample.crates)
  }

  /** Server → this player: my private state. */
  applyPrivateState(st: PrivateState): void {
    const a = this.local
    if (st.inventory) a.inventory.replace(st.inventory)
    if (st.magazine !== undefined) a.magazine = st.magazine
    if (st.reloading !== undefined) a.reloadUntil = st.reloading ? this.time + RIFLE.reloadSeconds : 0
    if (st.health !== undefined) {
      if (st.health < a.health) a.hurtAt = this.time
      a.health = st.health
    }
    if (st.hurtAt !== undefined) a.hurtAt = this.time
    if (st.poisoned !== undefined) a.poisonUntil = st.poisoned ? this.time + POISON.seconds : 0
    if (st.dead !== undefined && st.dead !== a.dead) {
      a.dead = st.dead
      if (st.dead) {
        this.cameraBeforeDeath = this.cameraMode
        this.cameraMode = 'third'
        this.breaking = null
        this.aiming = false
        if (this.panel !== 'none') this.closePanel()
        this.bestScore = saveBest(this.score)
      } else {
        this.cameraMode = this.cameraBeforeDeath
        this.player.state.stamina = PLAYER.maxStamina
      }
    }
    if (st.respawnIn !== undefined) a.respawnAt = this.time + st.respawnIn
    if (st.spawn) a.spawn = st.spawn
    if (st.teleport) this.teleportLocal(st.teleport.x, st.teleport.y, st.teleport.z)
    if (st.message) this.showMessage(st.message)
    for (const f of st.fx ?? []) {
      if (f.kind === 'flash') this.fx.muzzleFlash(f.ax, f.ay, f.az)
      else this.fx.tracer(new THREE.Vector3(f.ax, f.ay, f.az), new THREE.Vector3(f.bx, f.by, f.bz))
    }
  }

  applyBlockEdits(edits: readonly BlockEdit[]): void {
    for (const e of edits) {
      if (e.meta) this.world.setProp(e.meta)
      else this.world.setBlock(e.x, e.y, e.z, e.id)
    }
  }

  /** move the local player somewhere that may not be streamed yet (a bed on an island) */
  private teleportLocal(x: number, y: number, z: number): void {
    this.streamer.loadNow(x, z, INITIAL_LOAD_RADIUS)
    this.player.teleport(x, y, z)
  }

  /** Every action goes to the server, which decides what it does. */
  private act(msg: ClientMessage): void {
    this.session.send(msg)
  }

  /** the owner's manual save (the server also saves every minute, at dawn and when players leave) */
  requestSave(): void {
    this.act({ t: 'save' })
  }

  /** dev only: how many pointer-lock spikes the input layer has discarded (issue #14) */
  private loggedSpikes = 0
  private reportLookSpikes(): void {
    if (!import.meta.env.DEV) return
    const n = this.input.droppedSpikes
    if (n === this.loggedSpikes) return
    this.loggedSpikes = n
    console.info(`mouse: discarded ${n} pointer-lock delta spike${n === 1 ? '' : 's'}`)
  }

  /** is a prop block of this kind within `radius` of the player's chest? */
  isNear(block: number, radius: number): boolean {
    const a = this.local
    for (const p of this.world.props.values()) {
      if (p.id === block && Math.hypot(p.x + 0.5 - a.x, p.y + 0.5 - (a.y + 0.9), p.z + 0.5 - a.z) <= radius) return true
    }
    return false
  }

  // ---------------------------------------------------------------- messages
  showMessage(text: string): void {
    this.message = text
    this.messageUntil = this.time + MESSAGE_SECONDS
  }

  // ---------------------------------------------------------------- local input
  private handleEvent(ev: InputEvent): void {
    switch (ev.type) {
      case 'jump': this.player.queueJump(); break
      case 'hotbar': this.local.slot = ev.slot; this.breaking = null; break
      case 'primary': this.useItem(); break
      // a prospector in hand tunes on right click; anything else places
      case 'secondary': if (!this.tuneProspector()) this.place(); break
      case 'toggleCamera': this.cameraMode = this.cameraMode === 'first' ? 'third' : 'first'; break
      case 'drop': {
        const dir = this.camera.getWorldDirection(this.tmpDir)
        this.act({ t: 'dropHeld', slot: this.local.slot, dx: dir.x, dz: dir.z })
        break
      }
      case 'reload': this.act({ t: 'reload' }); break
      case 'inventory': this.openPanel('crafting'); break
      case 'interact': this.interact(); break
    }
  }

  private viewRay(): Ray {
    const dir = this.camera.getWorldDirection(this.tmpDir)
    const e = this.local.eye()
    // in third person the ray still starts at the head, not the camera
    return { ox: e.x, oy: e.y, oz: e.z, dx: dir.x, dy: dir.y, dz: dir.z }
  }

  /** F: loot a crate, set respawn at a bed, or open crafting at a workbench. */
  private interact(): void {
    if (this.crateTarget) {
      this.act({ t: 'interact', x: 0, y: 0, z: 0, block: 0, crate: this.crateTarget.id })
      return
    }
    const t = this.target
    if (!t) return
    if (t.block === BLOCK.workbench) this.openPanel('crafting')
    else if (t.block === BLOCK.bed) this.act({ t: 'interact', x: t.x, y: t.y, z: t.z, block: t.block, crate: null })
  }

  /** Left click: the rifle fires; anything else swings at what is in front (the sword hard, hands and tools weakly) and, unless it is the sword, digs while held. */
  private useItem(): void {
    const held = this.heldItem
    if (held === 'rifle') { this.fire(); return }
    this.act({ t: 'swing', ...this.viewRay() })
    this.swing()
  }

  private swing(): void {
    this.swingUntil = this.time + SWING_SECONDS
    this.viewModel.swing()
  }

  get reloading(): boolean {
    return this.time < this.local.reloadUntil
  }

  private fire(): void {
    const a = this.local
    if (this.reloading || this.panel !== 'none' || this.time < a.nextShotAt || this.dead) return
    if (a.magazine <= 0) { this.act({ t: 'reload' }); return }
    const ray = this.viewRay()
    this.act({ t: 'fire', ...ray })
    // immediate feedback here; damage is resolved by the server
    a.nextShotAt = this.time + RIFLE.interval
    this.swing()
    this.player.look(0, -RIFLE.kick / PLAYER.mouseSensitivity)
    const muzzle = new THREE.Vector3(ray.ox + ray.dx * 0.6, ray.oy - 0.15, ray.oz + ray.dz * 0.6)
    this.fx.muzzleFlash(muzzle.x, muzzle.y, muzzle.z)
    const wall = raycastVoxels(this.world, ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, RIFLE.range)
    const d = wall ? wall.distance : RIFLE.range
    this.fx.tracer(muzzle, new THREE.Vector3(ray.ox + ray.dx * d, ray.oy + ray.dy * d, ray.oz + ray.dz * d))
  }

  private updateAiming(dt: number): void {
    const rifle = this.heldItem === 'rifle' && !this.dead
    this.aiming = rifle && this.input.isButtonDown(2) && this.panel === 'none'
    const targetFov = this.aiming ? ADS.fov : ADS.normalFov
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, ADS.speed * dt)
      this.camera.updateProjectionMatrix()
    }
    if (rifle && this.input.isButtonDown(0) && this.time >= this.local.nextShotAt) this.fire()
  }

  /** Hold-to-dig: progress accumulates while the left button is held on the same block. */
  private updateBreaking(dt: number): void {
    const t = this.target
    const held = this.heldItem
    const digging = !this.dead && this.input.isButtonDown(0) && t && held !== 'rifle' && !isSword(held)
    if (!digging) { this.breaking = null; return }
    if (!this.breaking || this.breaking.x !== t.x || this.breaking.y !== t.y || this.breaking.z !== t.z) {
      this.breaking = { x: t.x, y: t.y, z: t.z, progress: 0 }
    }
    const seconds = breakTime(t.block, held) // bedrock and pickaxe-only blocks are Infinity
    if (!Number.isFinite(seconds)) return
    this.breaking.progress += dt / seconds
    if (this.time > this.swingUntil - SWING_SECONDS * 0.5) this.swing()
    if (this.breaking.progress >= 1) {
      this.act({ t: 'break', x: t.x, y: t.y, z: t.z })
      this.breaking = null
    }
  }

  place(): void {
    const t = this.target
    if (!t || this.dead || (t.nx === 0 && t.ny === 0 && t.nz === 0)) return
    const stack = this.inventory.get(this.local.slot)
    if (!stack || getItem(stack.id).block === undefined) return
    const yaw = Math.round(this.player.state.yaw / (Math.PI / 2)) * (Math.PI / 2)
    this.act({ t: 'place', x: t.x, y: t.y, z: t.z, nx: t.nx, ny: t.ny, nz: t.nz, slot: this.local.slot, yaw })
    this.swing()
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

  /** Craft from the UI (the server does the crafting). */
  craftRecipe(recipeId: string): void {
    this.act({ t: 'craft', recipe: recipeId })
  }

  moveSlot(from: number, to: number): void {
    if (from !== to) this.act({ t: 'moveSlot', from, to })
  }

  // ---------------------------------------------------------------- camera / targeting / anim
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
    this.target = this.dead ? null : raycastVoxels(this.world, ox, oy, oz, dir.x, dir.y, dir.z, REACH)
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

  // ---------------------------------------------------------------- score
  get score(): number {
    return computeScore(this.nightsSurvived, this.local.kills)
  }

  get nightsSurvived(): number {
    return nightsSurvived(this.dayNight.night, this.dayNight.phase)
  }

  /** seconds until the player respawns (0 when alive) */
  get respawnIn(): number {
    return this.dead ? Math.max(0, this.local.respawnAt - this.time) : 0
  }

  /** seconds since the player died (0 when alive) */
  get deadFor(): number {
    return this.dead ? RESPAWN_SECONDS - this.respawnIn : 0
  }

  // ---------------------------------------------------------------- ui
  private publishUi(): void {
    const s = this.player.state
    const a = this.local
    const held = this.heldItem
    const nights = this.nightsSurvived
    // the board is up on Tab or the pause screen; only then are the fixes worth computing
    const boardShown = this.input.isDown('Tab') || !this.input.locked
    const players = [
      { id: a.id, name: a.name, score: computeScore(nights, a.kills), kills: a.kills, deaths: a.deaths, you: true, where: null },
      ...[...this.remotePoses.values()].map(p => ({
        id: p.id, name: p.name, score: computeScore(nights, p.kills), kills: p.kills, deaths: p.deaths, you: false,
        where: boardShown ? whereOf(s, p) : null,
      })),
    ].sort((x, y) => y.score - x.score)
    useUiStore.getState().sync({
      locked: this.input.locked,
      hotbarSlot: a.slot,
      inventoryVersion: a.inventory.version,
      hotbar: a.inventory.hotbar(),
      targetBlock: this.target?.block ?? AIR,
      position: [s.x, s.y, s.z],
      health: a.health,
      stamina: s.stamina,
      ammo: held === 'rifle' ? { mag: a.magazine, reserve: a.inventory.count('ammo') } : null,
      cameraMode: this.cameraMode,
      breakProgress: this.breaking?.progress ?? 0,
      canBreak: this.target ? Number.isFinite(breakTime(this.target.block, held)) : true,
      panel: this.panel,
      nearWorkbench: this.nearWorkbench,
      message: this.time < this.messageUntil ? this.message : '',
      interactHint: this.crateTarget ? `F  take loot (${this.crateTarget.count})`
        : this.target?.block === BLOCK.bed ? 'F  set respawn'
        : this.target?.block === BLOCK.workbench ? 'F  craft'
        : this.player.state.inUpdraft ? 'Space  rise · Shift  sink · walk out to drop' : '',
      timer: this.dayNight.timerText,
      phase: this.dayNight.phase,
      night: this.dayNight.night,
      zombies: this.zombies.liveCount,
      kills: a.kills,
      hurtAt: a.hurtAt,
      poisoned: this.time < a.poisonUntil,
      aiming: this.aiming,
      reloading: this.reloading,
      dead: this.dead,
      respawnIn: this.respawnIn,
      score: this.score,
      bestScore: this.bestScore,
      nightsSurvived: nights,
      deaths: a.deaths,
      timeAlive: this.dayNight.time,
      scoreboard: this.input.isDown('Tab'),
      prospector: this.prospectRange > 0
        ? { ore: this.prospectOre, range: this.prospectRange, found: this.oreFixes.length }
        : null,
      surfaceY: this.terrain.ground.height(Math.floor(s.x), Math.floor(s.z)),
      players,
      roomCode: this.session.code,
      role: this.role,
    })
  }

  /** the current view-projection, as projectMarker wants it (column-major elements) */
  private viewProjection(): ArrayLike<number> {
    this.camera.updateMatrixWorld()
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert()
    return this.tmpViewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements
  }

  /**
   * Where the other players are on screen (issue #15): a marker over each one in
   * view beyond arm's reach, and one pinned to the edge for each one out of view.
   * Quantised so the store only re-renders when something moved visibly.
   */
  private publishMarkers(): void {
    const markers: PlayerMarker[] = []
    if (this.remotePoses.size > 0 && this.input.locked && !this.aiming) {
      const vp = this.viewProjection()
      const s = this.player.state
      for (const p of this.remotePoses.values()) {
        const m = projectMarker(vp, p.x, p.y + MARKER_HEAD_M, p.z)
        const distance = Math.round(Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z))
        if (m.onScreen && distance < MARKER_NEAR_M) continue
        markers.push({
          id: p.id, name: p.name, distance,
          x: Math.round(m.x * 500) / 500, y: Math.round(m.y * 500) / 500,
          onScreen: m.onScreen, angle: Math.round(m.angle),
        })
      }
    }
    useUiStore.getState().syncMarkers(markers)
  }

  // ---------------------------------------------------------------- the prospector (issue #25)
  /** how far the held prospector senses, or 0 when none is in hand */
  get prospectRange(): number {
    const held = this.heldItem
    return (held ? getItem(held).senseRange : undefined) ?? 0
  }

  /** the ore the prospector is tuned to */
  get prospectTuning(): number {
    return this.prospectOre
  }

  /**
   * Right click with a prospector in hand: tune it to the next ore. Returns false when
   * there is no prospector, so the click falls through to placing a block.
   */
  tuneProspector(): boolean {
    if (this.prospectRange === 0 || this.dead) return false
    const i = ORES.findIndex(o => o.block === this.prospectOre)
    const next = ORES[(i + 1) % ORES.length]
    this.prospectOre = next.block
    this.nextProspectAt = 0
    this.showMessage(`Prospector tuned to ${next.drop}`)
    return true
  }

  /** Rescan for the tuned ore, at most every PROSPECT_INTERVAL and only while one is held. */
  private updateProspector(): void {
    const range = this.prospectRange
    if (range === 0 || this.dead) {
      if (this.oreFixes.length) this.oreFixes = []
      return
    }
    if (this.time < this.nextProspectAt) return
    // a wider lens reads four times the chunks, so it reads them half as often
    this.nextProspectAt = this.time + PROSPECT_INTERVAL * (range > 40 ? 2 : 1)
    const s = this.player.state
    this.oreFixes = scanForOre(this.world, this.prospectOre, s.x, s.y + PLAYER.eyeHeight, s.z, range, WORLD_CHUNKS_Y)
  }

  /**
   * The ore fixes as screen markers, on the same footing as the player ones: over the
   * pocket when it is in view, pinned to the edge with an arrow when it is not.
   */
  private publishOreMarkers(): void {
    const markers: OreMarker[] = []
    if (this.oreFixes.length && this.input.locked && !this.aiming) {
      const vp = this.viewProjection()
      for (const f of this.oreFixes) {
        if (f.distance < ORE_MARKER_NEAR_M) continue
        const m = projectMarker(vp, f.x, f.y, f.z)
        markers.push({
          id: `${Math.floor(f.x)},${Math.floor(f.y)},${Math.floor(f.z)}`,
          distance: Math.round(f.distance),
          count: f.count,
          x: Math.round(m.x * 500) / 500, y: Math.round(m.y * 500) / 500,
          onScreen: m.onScreen, angle: Math.round(m.angle),
        })
      }
    }
    useUiStore.getState().syncOreMarkers(markers)
  }
}
