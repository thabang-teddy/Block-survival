/**
 * The simulation. Plain TypeScript, ticked once per frame from <GameLoop>.
 *
 * Roles: the **host** runs the authoritative sim (world edits, zombies, drops, crates,
 * clock, damage) for every player; solo play is a host with no peers. A **client**
 * moves its own player locally, sends inputs and action requests, and mirrors
 * everything else from host snapshots. Actions from the local player are expressed as
 * the same ClientMessages a remote client would send, so one handler serves both.
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
import { ZombieRenderer, preloadZombies } from '../render/ZombieRenderer'
import { RemotePlayerRenderer } from '../render/RemotePlayerRenderer'
import { CombatFx } from '../render/CombatFx'
import { PlayerController, PLAYER } from '../physics/playerController'
import { rayBox } from '../physics/aabb'
import { Input, type InputEvent } from '../input/Input'
import { breakTime, dropForBlock, getItem } from '../items/registry'
import { craft, getRecipe } from '../items/recipes'
import { DropManager } from '../entities/drops'
import { CrateManager, type LootCrate } from '../entities/crates'
import { kindsForNight, ZombieManager, ZOMBIE, ZOMBIE_STATS, zombiesForNight, type Zombie } from '../entities/zombies'
import { makeRng } from '../world/noise'
import { Avatar, AVATAR, type Spawn } from './Avatar'
import { DayNight, NIGHT_SECONDS } from './DayNight'
import { computeScore, loadBest, nightsSurvived, saveBest } from './score'
import type { HostSession } from '../net/HostSession'
import type { ClientSession } from '../net/ClientSession'
import type { BlockEdit, ClientMessage, PlayerSnap, PrivateState, Snapshot } from '../net/protocol'
import { useUiStore } from '../state/uiStore'

export const REACH = 5
export type CameraMode = 'first' | 'third'
export type AnimName = 'Idle' | 'Walk' | 'Run' | 'Aim' | 'Swing'
export type Panel = 'none' | 'crafting'
export type Role = 'host' | 'client'

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
/** requests from clients must originate within this distance of their avatar's eye */
const ACTION_REACH = REACH + 1.5
const HOST_ID = 'host'

export interface GameOptions {
  role: Role
  name: string
  session: HostSession | ClientSession
}

type Ray = { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }

export class Game {
  readonly role: Role
  readonly seed = ISLAND_LARGE.seed
  readonly world = new World()
  readonly island: IslandInfo
  readonly chunks: ChunkRenderer
  readonly props: PropRenderer
  readonly player: PlayerController
  readonly input: Input
  readonly drops: DropManager
  readonly crates: CrateManager
  readonly zombies: ZombieManager
  readonly zombieRenderer = new ZombieRenderer()
  readonly remotePlayers = new RemotePlayerRenderer()
  readonly viewModel = new ViewModel()
  readonly dayNight = new DayNight()
  readonly fx = new CombatFx()
  readonly camera: THREE.PerspectiveCamera
  /** wireframe cube on the targeted block */
  readonly highlight: THREE.LineSegments
  /** light carried by the player while holding a torch */
  readonly heldLight = new THREE.PointLight(0xffb060, 8, 7, 2)
  readonly session: HostSession | ClientSession
  /** every player in the match, keyed by peer id; the host is 'host' */
  readonly avatars = new Map<string, Avatar>()
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
  /** sim times at which the next zombie groups spawn this night (host) */
  private spawnTimes: number[] = []
  /** block edits since the last network flush (host) */
  private blockEdits: BlockEdit[] = []
  private readonly tmpDir = new THREE.Vector3()
  private readonly tmpRight = new THREE.Vector3()

  get inventory() { return this.local.inventory }
  get hotbarSlot(): number { return this.local.slot }
  set hotbarSlot(v: number) { this.local.slot = v }
  get magazine(): number { return this.local.magazine }
  get dead(): boolean { return this.local.dead }
  get deaths(): number { return this.local.deaths }
  get hurtAt(): number { return this.local.hurtAt }
  get heldItem(): string | null { return this.local.heldItem }
  get isHost(): boolean { return this.role === 'host' }

  constructor(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera, opts: GameOptions) {
    this.role = opts.role
    this.session = opts.session
    this.camera = camera
    this.camera.rotation.order = 'YXZ'
    this.camera.add(this.viewModel.group)
    const t0 = performance.now()
    this.island = generateIsland(this.world, ISLAND_LARGE)
    this.world.trackEdits = true
    let spawn: Spawn = this.island.spawn
    if (opts.session.role === 'client') {
      const w = opts.session.welcome!
      this.applyBlockEdits(w.edits)
      this.dayNight.time = w.time
      spawn = w.spawn
    }
    const t1 = performance.now()
    this.chunks = new ChunkRenderer(this.world)
    this.chunks.buildAll()
    this.props = new PropRenderer(this.world)
    const t2 = performance.now()
    console.info(
      `island: ${this.island.voxelCount} voxels, ${this.world.chunkCount} chunks — gen ${(t1 - t0).toFixed(0)} ms, mesh ${(t2 - t1).toFixed(0)} ms (${this.role})`,
    )
    const localId = opts.session.role === 'client' ? opts.session.welcome!.you : HOST_ID
    this.local = new Avatar(localId, opts.name, spawn)
    this.avatars.set(localId, this.local)
    this.player = new PlayerController(this.world, spawn)
    this.input = new Input(canvas)
    this.drops = new DropManager(this.world)
    this.crates = new CrateManager(this.world)
    this.zombies = new ZombieManager(
      {
        world: this.world,
        // attacks are resolved in hostTick against the nearest avatar
        damagePlayer: () => {},
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
    opts.session.attach(this)
  }

  dispose(): void {
    this.input.dispose()
    this.chunks.dispose()
    this.props.dispose()
    this.drops.dispose()
    this.zombieRenderer.dispose()
    this.remotePlayers.dispose()
    this.fx.dispose()
    this.crates.dispose()
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
    for (const ev of this.input.takeEvents()) if (!this.dead) this.handleEvent(ev)
    this.player.update(dt, this.input, this.dead)
    this.mirrorLocalPose()
    this.updateAiming(dt)
    this.syncCamera()
    this.updateTarget()
    this.updateBreaking(dt)

    if (this.isHost) this.hostTick(dt)
    else this.clientTick(dt)

    const s = this.player.state
    const moving = Math.hypot(s.vx, s.vz) > 0.5 && s.onGround
    this.viewModel.setItem(this.heldItem)
    this.viewModel.update(dt, moving, this.cameraMode === 'first' && !this.dead)
    this.updateAnim(moving)
    this.nearWorkbench = this.isNear(this.local, BLOCK.workbench, BENCH_REACH)
    this.heldLight.visible = this.heldItem === 'torch' && !this.dead
    this.heldLight.position.set(s.x, s.y + 1.3, s.z)
    this.chunks.update()
    this.props.update(dt, this.camera.position.x, this.camera.position.y, this.camera.position.z)
    this.zombieRenderer.update(dt, this.zombies)
    this.remotePlayers.update(dt, this.remotePoses.values())
    this.crates.update(this.time)
    this.fx.update(dt)
    this.publishUi()
  }

  private mirrorLocalPose(): void {
    const s = this.player.state
    const a = this.local
    a.x = s.x; a.y = s.y; a.z = s.z; a.yaw = s.yaw; a.pitch = s.pitch
    a.anim = this.anim
    a.aiming = this.aiming
  }

  // ---------------------------------------------------------------- host
  private hostTick(dt: number): void {
    const session = this.session as HostSession
    this.updateNight(dt)
    const alive = [...this.avatars.values()].filter(a => a.alive)
    this.zombies.update(dt, alive.map(a => ({ x: a.x, y: a.y, z: a.z })))
    for (const z of this.zombies.zombies) {
      if (!z.attacked || z.state !== 'attack') continue
      const victim = this.nearestAvatar(z.x, z.y, z.z)
      if (victim) this.hurt(victim, ZOMBIE_STATS[z.kind].damage, ZOMBIE_STATS[z.kind].poisons)
    }
    this.drops.update(dt, alive.map(a => ({ x: a.x, y: a.y, z: a.z, inv: a.inventory })))
    for (const a of this.avatars.values()) {
      a.tickHealth(dt)
      if (this.time < a.poisonUntil) a.damage(POISON.dps * dt)
      if (a.pendingRounds && this.time >= a.reloadUntil) {
        a.magazine += a.pendingRounds
        a.pendingRounds = 0
        if (a !== this.local) a.push({ magazine: a.magazine, reloading: false })
      }
      if (a.health <= 0 && !a.dead) this.die(a)
      if (a.dead && this.time >= a.respawnAt) this.respawn(a)
      if (a !== this.local) this.remotePoses.set(a.id, this.snapOf(a))
    }
    session.tick(dt)
  }

  private nearestAvatar(x: number, y: number, z: number): Avatar | null {
    let best: Avatar | null = null
    let bestD = Infinity
    for (const a of this.avatars.values()) {
      if (!a.alive) continue
      const d = Math.hypot(a.x - x, a.y - y, a.z - z)
      if (d < bestD) { bestD = d; best = a }
    }
    return bestD <= ZOMBIE.attackRange + 0.8 ? best : null
  }

  // ---------------------------------------------------------------- client
  private clientTick(dt: number): void {
    const session = this.session as ClientSession
    session.tick(dt)
    const now = performance.now() / 1000
    const sample = session.buffer.sample(now)
    if (!sample) return
    this.dayNight.time = session.buffer.hostTime(now)
    this.dayNight.update(0)
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
    this.drops.applySnapshot(sample.drops, this.time)
    this.crates.applySnapshot(sample.crates)
  }

  /** Host → this client: my private state. */
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
        if (this.panel !== 'none') this.closePanel()
      } else {
        this.cameraMode = this.cameraBeforeDeath
        this.player.state.stamina = PLAYER.maxStamina
      }
    }
    if (st.respawnIn !== undefined) a.respawnAt = this.time + st.respawnIn
    if (st.spawn) a.spawn = st.spawn
    if (st.teleport) this.player.teleport(st.teleport.x, st.teleport.y, st.teleport.z)
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

  // ---------------------------------------------------------------- network helpers (host)
  addRemoteAvatar(id: string, name: string): Avatar {
    const a = new Avatar(id, name, this.island.spawn)
    this.avatars.set(id, a)
    return a
  }

  removeAvatar(id: string): void {
    this.avatars.delete(id)
    this.remotePoses.delete(id)
  }

  worldEdits(): BlockEdit[] {
    const out: BlockEdit[] = []
    for (const e of this.world.edits.values()) {
      const meta = this.world.getProp(e.x, e.y, e.z)
      out.push(meta ? { ...e, meta } : e)
    }
    return out
  }

  takeBlockEdits(): BlockEdit[] {
    const out = this.blockEdits
    this.blockEdits = []
    return out
  }

  private recordEdit(x: number, y: number, z: number): void {
    const meta = this.world.getProp(x, y, z)
    this.blockEdits.push({ x, y, z, id: this.world.getBlock(x, y, z), ...(meta ? { meta } : {}) })
  }

  private snapOf(a: Avatar): PlayerSnap {
    return {
      id: a.id, name: a.name, x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: a.pitch, anim: a.anim,
      held: a.heldItem, health: a.health, dead: a.dead, kills: a.kills, deaths: a.deaths,
    }
  }

  buildSnapshot(): Snapshot {
    return {
      t: 'snap',
      time: this.dayNight.time,
      players: [...this.avatars.values()].map(a => this.snapOf(a)),
      zombies: this.zombies.zombies.map(z => ({
        id: z.id, kind: z.kind, x: z.x, y: z.y, z: z.z, yaw: z.yaw, state: z.state, attacked: z.attacked, burnTimer: z.burnTimer,
      })),
      drops: this.drops.drops.map(d => ({ id: d.id, item: d.item, x: d.x, y: d.y, z: d.z })),
      crates: this.crates.crates.map(c => ({ id: c.id, x: c.x, y: c.y, z: c.z, items: c.items.length })),
    }
  }

  /** Every action, from the local player or a client, comes through here on the host. */
  applyClientMessage(a: Avatar, msg: ClientMessage): void {
    switch (msg.t) {
      case 'input':
        if (a === this.local) return
        a.x = msg.x; a.y = msg.y; a.z = msg.z; a.yaw = msg.yaw; a.pitch = msg.pitch
        a.anim = msg.anim; a.slot = msg.slot; a.aiming = msg.aiming
        return
      case 'break': this.doBreak(a, msg.x, msg.y, msg.z); return
      case 'place': this.doPlace(a, msg); return
      case 'craft': this.doCraft(a, msg.recipe); return
      case 'moveSlot': if (msg.from !== msg.to) a.inventory.swap(msg.from, msg.to); return
      case 'dropHeld': this.doDropHeld(a, msg.slot, msg.dx, msg.dz); return
      case 'interact': this.doInteract(a, msg); return
      case 'swing': this.doSwing(a, msg); return
      case 'fire': this.doFire(a, msg); return
      case 'reload': this.doReload(a); return
      case 'chat': return
      case 'hello': return
    }
  }

  /** Local action: apply directly on the host, or send to it from a client. */
  private act(msg: ClientMessage): void {
    if (this.isHost) this.applyClientMessage(this.local, msg)
    else (this.session as ClientSession).send(msg)
  }

  // ---------------------------------------------------------------- night (host)
  private updateNight(dt: number): void {
    const dn = this.dayNight
    dn.update(dt)
    if (dn.justChanged) {
      if (dn.phase === 'night') this.scheduleNight(dn.night)
      else {
        this.zombies.burnAll()
        this.spawnTimes = []
        this.broadcastMessage(`Dawn — you survived night ${dn.night}`)
        this.bestScore = saveBest(this.score)
      }
    }
    while (this.spawnTimes.length && dn.time >= this.spawnTimes[0]) {
      this.spawnTimes.shift()
      const targets = [...this.avatars.values()].filter(a => a.alive).map(a => ({ x: a.x, y: a.y, z: a.z }))
      this.zombies.spawnGroup(kindsForNight(dn.night), 3 + Math.floor(Math.random() * 4), targets, 28)
    }
  }

  /** Split the night's zombie count into groups of 3–6 spread over the spawn window. */
  private scheduleNight(night: number): void {
    const total = zombiesForNight(night)
    const groups = Math.max(1, Math.round(total / 4.5))
    const window = NIGHT_SECONDS * SPAWN_WINDOW
    this.spawnTimes = Array.from({ length: groups }, (_, i) => this.dayNight.time + 2 + (i * window) / groups)
    this.broadcastMessage(`Night ${night} — they are coming`)
  }

  private hurt(a: Avatar, amount: number, poison: boolean): void {
    a.damage(amount)
    a.hurtAt = this.time
    if (poison) a.poisonUntil = this.time + POISON.seconds
    if (a !== this.local) a.push({ health: a.health, hurtAt: 1, poisoned: this.time < a.poisonUntil })
  }

  /** Death: the inventory becomes a loot crate where you fell; respawn after 5 s at the bed / pad. */
  private die(a: Avatar): void {
    a.deaths++
    a.dead = true
    a.respawnAt = this.time + RESPAWN_SECONDS
    this.crates.dropInventory(a.inventory, a.x, a.y + 0.5, a.z)
    a.magazine = 0
    a.pendingRounds = 0
    a.reloadUntil = 0
    a.poisonUntil = 0
    if (a === this.local) {
      this.breaking = null
      this.aiming = false
      this.cameraBeforeDeath = this.cameraMode
      this.cameraMode = 'third'
      if (this.panel !== 'none') this.closePanel()
    } else {
      a.push({ dead: true, respawnIn: RESPAWN_SECONDS, magazine: 0, reloading: false, poisoned: false })
    }
    this.bestScore = saveBest(this.score)
  }

  private respawn(a: Avatar): void {
    a.dead = false
    a.health = AVATAR.maxHealth
    a.sinceDamage = 0
    const sp = a.spawn
    a.x = sp.x; a.y = sp.y; a.z = sp.z
    const msg = this.crates.crates.length ? 'Your loot crate is where you fell' : 'Back on your feet'
    if (a === this.local) {
      this.player.teleport(sp.x, sp.y, sp.z)
      this.player.state.stamina = PLAYER.maxStamina
      this.cameraMode = this.cameraBeforeDeath
      this.showMessage(msg)
    } else {
      a.push({ dead: false, health: a.health, teleport: sp, message: msg })
    }
  }

  // ---------------------------------------------------------------- actions (host authority)
  private withinReach(a: Avatar, x: number, y: number, z: number): boolean {
    const e = a.eye()
    return Math.hypot(x + 0.5 - e.x, y + 0.5 - e.y, z + 0.5 - e.z) <= ACTION_REACH
  }

  private doBreak(a: Avatar, x: number, y: number, z: number): void {
    if (a.dead || !this.withinReach(a, x, y, z)) return
    const block = this.world.getBlock(x, y, z)
    if (block === AIR || y <= this.world.bounds.minY + 1) return
    if (!Number.isFinite(breakTime(block, a.heldItem))) return
    this.breakBlock(x, y, z, block)
  }

  private breakBlock(x: number, y: number, z: number, block: number): void {
    // multi-cell props (bed) go together and drop once
    const partner = this.world.getProp(x, y, z)?.partner
    this.world.setBlock(x, y, z, AIR)
    this.recordEdit(x, y, z)
    if (partner) {
      this.world.setBlock(partner.x, partner.y, partner.z, AIR)
      this.recordEdit(partner.x, partner.y, partner.z)
    }
    const item = dropForBlock(block)
    if (item) this.drops.spawn(item, 1, x + 0.5, y + 0.3, z + 0.5, (Math.random() - 0.5) * 2, 2.5, (Math.random() - 0.5) * 2)
  }

  private anyAvatarOverlaps(x: number, y: number, z: number): boolean {
    const half = PLAYER.width / 2
    for (const a of this.avatars.values()) {
      if (a.dead) continue
      if (a.x - half < x + 1 && a.x + half > x && a.y < y + 1 && a.y + PLAYER.height > y && a.z - half < z + 1 && a.z + half > z) return true
    }
    return false
  }

  private canOccupy(x: number, y: number, z: number, solid: boolean): boolean {
    const existing = this.world.getBlock(x, y, z)
    if (existing !== AIR && existing !== BLOCK.water) return false
    return !(solid && this.anyAvatarOverlaps(x, y, z))
  }

  private doPlace(a: Avatar, msg: Extract<ClientMessage, { t: 'place' }>): void {
    if (a.dead) return
    const stack = a.inventory.get(msg.slot)
    if (!stack) return
    const def = getItem(stack.id)
    if (def.block === undefined) return
    const x = msg.x + msg.nx
    const y = msg.y + msg.ny
    const z = msg.z + msg.nz
    if (!this.withinReach(a, x, y, z) || !this.canOccupy(x, y, z, isSolid(def.block))) return
    if (isProp(def.block)) {
      if (!this.placeProp(def.block, x, y, z, msg.yaw)) return
    } else {
      this.world.setBlock(x, y, z, def.block)
      this.recordEdit(x, y, z)
    }
    a.inventory.takeFromSlot(msg.slot, 1)
  }

  /** Props need a solid floor; the bed also needs its second cell. Returns false if blocked. */
  private placeProp(block: number, x: number, y: number, z: number, yaw: number): boolean {
    if (!isSolid(this.world.getBlock(x, y - 1, z))) return false
    const meta: PropMeta = { id: block, x, y, z, yaw, primary: true }
    if (block === BLOCK.bed) {
      const fx = x + Math.round(Math.sin(yaw))
      const fz = z + Math.round(Math.cos(yaw))
      if (!this.canOccupy(fx, y, fz, false) || !isSolid(this.world.getBlock(fx, y - 1, fz))) return false
      meta.partner = { x: fx, y, z: fz }
      this.world.setProp({ id: block, x: fx, y, z: fz, yaw, primary: false, partner: { x, y, z } })
      this.recordEdit(fx, y, fz)
    }
    this.world.setProp(meta)
    this.recordEdit(x, y, z)
    return true
  }

  private doCraft(a: Avatar, recipeId: string): void {
    if (a.dead) return
    const recipe = getRecipe(recipeId)
    const result = craft(a.inventory, recipe, this.isNear(a, BLOCK.workbench, BENCH_REACH))
    if (result && result.overflow > 0) this.drops.spawn(recipe.output.id, result.overflow, a.x, a.y + 1, a.z)
  }

  private doDropHeld(a: Avatar, slot: number, dx: number, dz: number): void {
    if (a.dead) return
    const stack = a.inventory.get(slot)
    if (!stack || a.inventory.takeFromSlot(slot, 1) !== 1) return
    this.drops.spawn(stack.id, 1, a.x + dx * 0.6, a.y + 1.3, a.z + dz * 0.6, dx * 4, 2.5, dz * 4)
  }

  private doInteract(a: Avatar, msg: Extract<ClientMessage, { t: 'interact' }>): void {
    if (a.dead) return
    if (msg.crate !== null) {
      const crate = this.crates.crates.find(c => c.id === msg.crate)
      if (!crate || Math.hypot(crate.x - a.x, crate.y - a.y, crate.z - a.z) > 5) return
      const n = this.crates.loot(crate, a.inventory)
      this.tell(a, n ? `Took ${n} item${n === 1 ? '' : 's'}` : 'Inventory full')
      return
    }
    if (msg.block === BLOCK.bed && this.world.getBlock(msg.x, msg.y, msg.z) === BLOCK.bed && this.withinReach(a, msg.x, msg.y, msg.z)) {
      a.spawn = { x: msg.x + 0.5, y: msg.y + 1, z: msg.z + 0.5 }
      if (a !== this.local) a.push({ spawn: a.spawn })
      this.tell(a, 'Respawn point set')
    }
  }

  private doSwing(a: Avatar, r: Ray): void {
    if (a.dead || a.heldItem !== 'sword') return
    for (const z of this.zombies.zombies) {
      if (z.state !== 'chase' && z.state !== 'attack') continue
      const vx = z.x - r.ox
      const vy = z.y + 1 - r.oy
      const vz = z.z - r.oz
      const d = Math.hypot(vx, vy, vz)
      if (d > SWORD.reach) continue
      if ((vx * r.dx + vy * r.dy + vz * r.dz) / (d || 1) < SWORD.arcCos) continue
      if (this.zombies.damage(z, SWORD.damage, r.dx * SWORD.knockback, r.dz * SWORD.knockback)) a.kills++
    }
  }

  private doFire(a: Avatar, r: Ray): void {
    if (a.dead || a.heldItem !== 'rifle' || this.time < a.reloadUntil || this.time < a.nextShotAt) return
    if (a.magazine <= 0) { this.doReload(a); return }
    a.magazine--
    a.nextShotAt = this.time + RIFLE.interval
    const wall = raycastVoxels(this.world, r.ox, r.oy, r.oz, r.dx, r.dy, r.dz, RIFLE.range)
    let bestT = wall ? wall.distance : RIFLE.range
    let hit: Zombie | null = null
    for (const z of this.zombies.zombies) {
      if (z.state !== 'chase' && z.state !== 'attack') continue
      const half = ZOMBIE.width / 2
      const t = rayBox(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz, { x: z.x - half, y: z.y, z: z.z - half, w: ZOMBIE.width, h: 2, d: ZOMBIE.width })
      if (t !== null && t < bestT) { hit = z; bestT = t }
    }
    if (hit) {
      const headshot = r.oy + r.dy * bestT > hit.y + 1.5
      const dmg = RIFLE.damage * (headshot ? RIFLE.headshot : 1) * ZOMBIE_STATS[hit.kind].rifleResist
      if (this.zombies.damage(hit, dmg, r.dx * 1.5, r.dz * 1.5)) a.kills++
    }
    if (a !== this.local) a.push({ magazine: a.magazine })
  }

  private doReload(a: Avatar): void {
    if (a.dead || a.heldItem !== 'rifle' || a.magazine === RIFLE_MAG || this.time < a.reloadUntil) return
    const have = Math.min(RIFLE_MAG - a.magazine, a.inventory.count('ammo'))
    if (have <= 0) return
    a.inventory.remove('ammo', have)
    a.reloadUntil = this.time + RIFLE.reloadSeconds
    a.pendingRounds = have
    if (a !== this.local) a.push({ reloading: true })
  }

  /** is a prop block of this kind within `radius` of the avatar's chest? */
  isNear(a: Avatar, block: number, radius: number): boolean {
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

  private tell(a: Avatar, text: string): void {
    if (a === this.local) this.showMessage(text)
    else a.push({ message: text })
  }

  private broadcastMessage(text: string): void {
    for (const a of this.avatars.values()) this.tell(a, text)
  }

  // ---------------------------------------------------------------- local input
  private handleEvent(ev: InputEvent): void {
    switch (ev.type) {
      case 'jump': this.player.queueJump(); break
      case 'hotbar': this.local.slot = ev.slot; this.breaking = null; break
      case 'primary': this.useItem(); break
      case 'secondary': this.place(); break
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

  /** Left click: weapons swing/fire; everything else digs (hold to continue). */
  private useItem(): void {
    const held = this.heldItem
    if (held === 'rifle') { this.fire(); return }
    if (held === 'sword') this.act({ t: 'swing', ...this.viewRay() })
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
    // immediate feedback on the client; damage is resolved by the host
    if (!this.isHost) a.nextShotAt = this.time + RIFLE.interval
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
    const digging = !this.dead && this.input.isButtonDown(0) && t && held !== 'rifle' && held !== 'sword'
    if (!digging) { this.breaking = null; return }
    if (!this.breaking || this.breaking.x !== t.x || this.breaking.y !== t.y || this.breaking.z !== t.z) {
      this.breaking = { x: t.x, y: t.y, z: t.z, progress: 0 }
    }
    if (t.y <= this.world.bounds.minY + 1) return // bedrock
    const seconds = breakTime(t.block, held)
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

  /** Craft from the UI (the host applies directly, a client asks the host). */
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
    const players = [
      { id: a.id, name: a.name, score: computeScore(nights, a.kills), kills: a.kills, deaths: a.deaths, you: true },
      ...[...this.remotePoses.values()].map(p => ({
        id: p.id, name: p.name, score: computeScore(nights, p.kills), kills: p.kills, deaths: p.deaths, you: false,
      })),
    ].sort((x, y) => y.score - x.score)
    const host = this.session.role === 'host' ? (this.session as HostSession) : null
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
        : this.target?.block === BLOCK.workbench ? 'F  craft' : '',
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
      players,
      roomCode: host ? (host.online ? host.code : '') : this.session.code,
      role: this.role,
    })
  }
}
