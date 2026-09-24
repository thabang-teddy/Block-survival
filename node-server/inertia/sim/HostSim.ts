/**
 * The authoritative simulation of one room, as the server runs it: the host half of
 * game/Game.ts with every player remote. World edits, zombies, drops, crates, the clock
 * and all damage are decided here; each client moves its own player and sends actions
 * as ClientMessages, and gets snapshots, block edits and its private state back.
 *
 * No DOM, no three.js, no network: the server's GameRoom feeds it messages and ticks it,
 * and the tests drive it directly.
 */
import { World, type PropMeta } from '../world/chunkStore.ts'
import { TerrainGenerator, WORLD_CHUNKS_Y } from '../world/terrainGen.ts'
import { ChunkStreamer } from '../world/chunkStreamer.ts'
import { raycastVoxels } from '../world/raycast.ts'
import { AIR, BLOCK, isProp, isSolid } from '../world/palette.ts'
import { makeRng } from '../world/noise.ts'
import { PLAYER } from '../physics/playerController.ts'
import { rayBox } from '../physics/aabb.ts'
import { breakTime, dropForBlock, getItem } from '../items/registry.ts'
import { craft, getRecipe } from '../items/recipes.ts'
import type { ItemStack } from '../items/inventory.ts'
import { DropManager } from '../entities/drops.ts'
import { CrateManager } from '../entities/crates.ts'
import { kindsForNight, ZombieManager, ZOMBIE, ZOMBIE_STATS, zombiesForNight, type Zombie } from '../entities/zombies.ts'
import { Avatar, AVATAR } from '../game/Avatar.ts'
import { DayNight } from '../game/DayNight.ts'
import { rulesToWire, type GameRules } from '../game/rules.ts'
import { nightsSurvived } from '../game/score.ts'
import { collectSave, restorePlayer, zombiesToRestore } from '../game/saveState.ts'
import { Visitors } from '../game/visitors.ts'
import type { SaveData } from '../game/saveTypes.ts'
import { PROTOCOL_VERSION, type BlockEdit, type ClientMessage, type PrivateState, type Snapshot, type Welcome } from '../net/protocol.ts'

export const REACH = 5
/** requests from clients must originate within this distance of their avatar's eye */
const ACTION_REACH = REACH + 1.5
/** a Workbench within this distance of the player enables bench recipes */
export const BENCH_REACH = 3
export const RIFLE_MAG = 30
const RIFLE = { damage: 12, headshot: 2, interval: 0.12, reloadSeconds: 2, range: 80 } as const
interface Melee { damage: number; reach: number; arcCos: number; knockback: number }
const SWORDS: Readonly<Record<string, Melee>> = {
  sword: { damage: 20, reach: 2.5, arcCos: Math.cos(Math.PI / 6), knockback: 6 },
  /** the diamond sword (issue #25): the same swing, harder */
  sword_diamond: { damage: 32, reach: 2.8, arcCos: Math.cos(Math.PI / 6), knockback: 7.5 },
}
/** bare hands or whatever tool is held: you can always fight back, just not well */
const FISTS: Melee = { damage: 5, reach: 2.0, arcCos: Math.cos(Math.PI / 6), knockback: 3 }
const POISON = { seconds: 5, dps: 2 } as const
export const RESPAWN_SECONDS = 5
/**
 * The server keeps a smaller ring of chunks around each player than a browser draws:
 * it only needs the ground zombies walk on, drops fall on and actions are checked
 * against, and it holds up to four players' worth.
 */
const SERVER_LOAD_RADIUS = 4
const SERVER_LOAD_BUDGET_MS = 12
/** columns loaded synchronously around a spawn before anyone plays on it */
const INITIAL_LOAD_RADIUS = 2
const MAX_DT = 1 / 20
/** a crate is lootable from this far */
const CRATE_REACH = 5
/**
 * Players move themselves, so the server only checks that a move is one a player could
 * make: at most this fast (m/s — sprinting, falling and riding an updraft, generously)
 * plus a little slack for a packet that took its time. Anything further (a modified
 * client teleporting, which would also make the server generate terrain wherever it
 * pleases) is refused and the player is put back where the server has them.
 */
export const MAX_MOVE_SPEED = 60
const MOVE_SLACK = 4

type Ray = { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }

/** one player's run, recorded on the leaderboard at dawn and when they die */
export interface Run {
  userId: number
  nights: number
  kills: number
  deaths: number
  seconds: number
}

export interface HostSimOptions {
  seed: number
  rules: GameRules
  /** continue a saved world */
  restore?: SaveData
  /** the account whose own world this is: they resume where they left off */
  ownerId?: number | null
}

export class HostSim {
  readonly seed: number
  readonly rules: GameRules
  readonly world = new World()
  readonly terrain: TerrainGenerator
  readonly streamer: ChunkStreamer
  readonly drops: DropManager
  readonly crates: CrateManager
  readonly zombies: ZombieManager
  readonly dayNight: DayNight
  /** every connected player, keyed by connection id */
  readonly avatars = new Map<string, Avatar>()
  /** a run worth recording (the room writes it to the leaderboard) */
  onRun: ((run: Run) => void) | null = null
  /** dawn broke: a good moment to save */
  onDawn: (() => void) | null = null
  private readonly ownerId: number | null
  private time = 0
  /** sim times at which the next zombie groups spawn this night */
  private spawnTimes: number[] = []
  /** block edits since the last network flush */
  private blockEdits: BlockEdit[] = []
  /** players who left (or have not reconnected since the load), by account id */
  private readonly visitors = new Visitors()
  /** sim time of each player's last accepted move */
  private readonly lastMove = new Map<string, number>()
  /** where each player joined: their controller puts them back there if they fall out of the world */
  private readonly joinedAt = new Map<string, { x: number; y: number; z: number }>()

  constructor(opts: HostSimOptions) {
    this.seed = opts.restore?.seed ?? opts.seed
    this.rules = opts.rules
    this.ownerId = opts.ownerId ?? null
    this.dayNight = new DayNight(this.rules)
    this.terrain = new TerrainGenerator(this.seed)
    this.world.setGenerator((cx, cy, cz) => this.terrain.generateChunk(cx, cy, cz), WORLD_CHUNKS_Y)
    this.world.trackEdits = true
    if (opts.restore) {
      this.applyBlockEdits(opts.restore.edits)
      this.dayNight.time = opts.restore.time
      this.dayNight.update(0)
      for (const [id, p] of Object.entries(opts.restore.players)) this.visitors.leaveSaved(id, p)
    }
    this.streamer = new ChunkStreamer(this.world, { radius: SERVER_LOAD_RADIUS, budgetMs: SERVER_LOAD_BUDGET_MS })
    const spawn = this.terrain.spawn()
    this.streamer.loadNow(spawn.x, spawn.z, INITIAL_LOAD_RADIUS)
    this.drops = new DropManager(this.world)
    this.crates = new CrateManager(this.world)
    this.zombies = new ZombieManager(
      {
        world: this.world,
        // attacks are resolved in tick() against the nearest avatar
        damagePlayer: () => {},
        breakBlock: (x, y, z) => this.breakBlock(x, y, z, this.world.getBlock(x, y, z)),
      },
      makeRng(Date.now() & 0xffff),
    )
    if (opts.restore) this.restoreLiveWorld(opts.restore)
  }

  get nightsSurvived(): number {
    return nightsSurvived(this.dayNight.night, this.dayNight.phase)
  }

  // ================================================================ players
  /**
   * A player connected. One we have seen before (this run or in the save) gets their
   * gear back; the world's owner also resumes where they stood.
   */
  addPlayer(id: string, name: string, userId: number | null): Avatar {
    const a = new Avatar(id, name, this.terrain.spawn())
    a.userId = userId
    const resumes = userId !== null && userId === this.ownerId
    const saved = resumes ? this.visitors.take(userId) : null
    if (saved) restorePlayer(a, saved, true)
    else this.visitors.arrive(a, userId)
    this.streamer.loadNow(a.x, a.z, INITIAL_LOAD_RADIUS)
    this.avatars.set(id, a)
    this.joinedAt.set(id, { x: a.x, y: a.y, z: a.z })
    return a
  }

  removePlayer(id: string): Avatar | null {
    const a = this.avatars.get(id)
    if (!a) return null
    this.visitors.leave(a, a.userId)
    this.avatars.delete(id)
    this.lastMove.delete(id)
    this.joinedAt.delete(id)
    return a
  }

  /** what a new player needs before their game starts */
  welcome(a: Avatar): Welcome {
    return {
      t: 'welcome', v: PROTOCOL_VERSION, you: a.id, seed: this.seed, time: this.dayNight.time,
      edits: this.worldEdits(), spawn: { x: a.x, y: a.y, z: a.z }, look: { yaw: a.yaw, pitch: a.pitch },
      rules: rulesToWire(this.rules),
    }
  }

  /** the first private state after the welcome: everything the client shows about itself */
  initialState(a: Avatar): PrivateState {
    a.inventoryVersionSent = a.inventory.version
    return { t: 'state', inventory: a.inventory.all(), magazine: a.magazine, health: a.health, spawn: a.spawn }
  }

  /** private state that changed since the last call, or null */
  takeState(a: Avatar): PrivateState | null {
    if (a.inventory.version !== a.inventoryVersionSent) {
      a.inventoryVersionSent = a.inventory.version
      a.push({ inventory: a.inventory.all() })
    }
    return a.takeOutbox()
  }

  tell(a: Avatar, text: string): void {
    a.push({ message: text })
  }

  broadcastMessage(text: string): void {
    for (const a of this.avatars.values()) this.tell(a, text)
  }

  // ================================================================ tick
  tick(rawDt: number): void {
    const dt = Math.min(rawDt, MAX_DT)
    this.time += dt
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
        a.push({ magazine: a.magazine, reloading: false })
      }
      if (a.health <= 0 && !a.dead) this.die(a)
      if (a.dead && this.time >= a.respawnAt) this.respawn(a)
    }
    // keep the world loaded around every player, and under every zombie and drop
    this.streamer.update([...this.avatars.values()], [...this.zombies.zombies, ...this.drops.drops])
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

  // ================================================================ network views
  snapshot(): Snapshot {
    return {
      t: 'snap',
      time: this.dayNight.time,
      players: [...this.avatars.values()].map(a => ({
        id: a.id, name: a.name, x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: a.pitch, anim: a.anim,
        held: a.heldItem, health: a.health, dead: a.dead, kills: a.kills, deaths: a.deaths,
      })),
      zombies: this.zombies.zombies.map(z => ({
        id: z.id, kind: z.kind, x: z.x, y: z.y, z: z.z, yaw: z.yaw, state: z.state, attacked: z.attacked, burnTimer: z.burnTimer,
      })),
      drops: this.drops.drops.map(d => ({ id: d.id, item: d.item, x: d.x, y: d.y, z: d.z })),
      crates: this.crates.crates.map(c => ({ id: c.id, x: c.x, y: c.y, z: c.z, items: c.items.length })),
    }
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

  // ================================================================ saving
  buildSave(): SaveData {
    return collectSave({
      seed: this.seed,
      time: this.dayNight.time,
      edits: this.worldEdits(),
      live: [...this.avatars.values()].filter(a => a.userId !== null).map(a => ({ userId: String(a.userId), avatar: a })),
      departed: this.visitors.entries,
      zombies: this.zombies.zombies,
      drops: this.drops.drops,
      crates: this.crates.crates,
    })
  }

  /** a cheap fingerprint of what a save holds: when it changes, the world is worth saving */
  saveSignature(): string {
    let inventories = 0
    let deaths = 0
    let spawns = 0
    for (const a of this.avatars.values()) {
      inventories += a.inventory.version
      deaths += a.deaths
      spawns += a.spawn.x * 31 + a.spawn.y * 17 + a.spawn.z
    }
    return `${this.world.edits.size}:${this.world.propsVersion}:${inventories}:${deaths}:${spawns}:${this.avatars.size}:${this.drops.drops.length}:${this.crates.crates.length}`
  }

  // ================================================================ actions
  /** every action from a client comes through here (already validated) */
  apply(a: Avatar, msg: ClientMessage): void {
    switch (msg.t) {
      case 'input':
        this.move(a, msg.x, msg.y, msg.z)
        a.yaw = msg.yaw; a.pitch = msg.pitch
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
      // chat, hello and save are the room's business
      case 'chat':
      case 'hello':
      case 'save':
        return
    }
  }

  /** accept a client's position if it is a move a player can make, else put them back */
  private move(a: Avatar, x: number, y: number, z: number): void {
    const since = this.time - (this.lastMove.get(a.id) ?? this.time - 1)
    const allowed = MAX_MOVE_SPEED * Math.max(since, 1 / 30) + MOVE_SLACK
    if (Math.hypot(x - a.x, y - a.y, z - a.z) > allowed && !this.outOfTheVoid(a, x, y, z)) {
      a.push({ teleport: { x: a.x, y: a.y, z: a.z } })
      return
    }
    a.x = x; a.y = y; a.z = z
    this.lastMove.set(a.id, this.time)
  }

  /** below the bedrock the client puts its player back where they joined, or at their spawn */
  private outOfTheVoid(a: Avatar, x: number, y: number, z: number): boolean {
    if (a.y >= PLAYER.voidY) return false
    const near = (p: { x: number; y: number; z: number } | undefined) => !!p && Math.hypot(x - p.x, y - p.y, z - p.z) < 1
    return near(this.joinedAt.get(a.id)) || near(a.spawn)
  }

  applyBlockEdits(edits: readonly BlockEdit[]): void {
    for (const e of edits) {
      if (e.meta) this.world.setProp(e.meta)
      else this.world.setBlock(e.x, e.y, e.z, e.id)
    }
  }

  private withinReach(a: Avatar, x: number, y: number, z: number): boolean {
    const e = a.eye()
    return Math.hypot(x + 0.5 - e.x, y + 0.5 - e.y, z + 0.5 - e.z) <= ACTION_REACH
  }

  private doBreak(a: Avatar, x: number, y: number, z: number): void {
    if (a.dead || !this.withinReach(a, x, y, z)) return
    const block = this.world.getBlock(x, y, z)
    if (block === AIR) return
    if (!Number.isFinite(breakTime(block, a.heldItem))) return // includes bedrock
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

  private recordEdit(x: number, y: number, z: number): void {
    const meta = this.world.getProp(x, y, z)
    this.blockEdits.push({ x, y, z, id: this.world.getBlock(x, y, z), ...(meta ? { meta } : {}) })
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
      if (!crate || Math.hypot(crate.x - a.x, crate.y - a.y, crate.z - a.z) > CRATE_REACH) return
      const n = this.crates.loot(crate, a.inventory)
      this.tell(a, n ? `Took ${n} item${n === 1 ? '' : 's'}` : 'Inventory full')
      return
    }
    if (msg.block === BLOCK.bed && this.world.getBlock(msg.x, msg.y, msg.z) === BLOCK.bed && this.withinReach(a, msg.x, msg.y, msg.z)) {
      a.spawn = { x: msg.x + 0.5, y: msg.y + 1, z: msg.z + 0.5 }
      a.push({ spawn: a.spawn })
      this.tell(a, 'Respawn point set')
    }
  }

  private doSwing(a: Avatar, r: Ray): void {
    if (a.dead || a.heldItem === 'rifle') return
    const m = (a.heldItem !== null ? SWORDS[a.heldItem] : undefined) ?? FISTS
    for (const z of this.zombies.zombies) {
      if (z.state !== 'chase' && z.state !== 'attack') continue
      const vx = z.x - r.ox
      const vy = z.y + 1 - r.oy
      const vz = z.z - r.oz
      const d = Math.hypot(vx, vy, vz)
      if (d > m.reach) continue
      if ((vx * r.dx + vy * r.dy + vz * r.dz) / (d || 1) < m.arcCos) continue
      if (this.zombies.damage(z, m.damage, r.dx * m.knockback, r.dz * m.knockback)) a.kills++
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
    a.push({ magazine: a.magazine })
  }

  private doReload(a: Avatar): void {
    if (a.dead || a.heldItem !== 'rifle' || a.magazine === RIFLE_MAG || this.time < a.reloadUntil) return
    const have = Math.min(RIFLE_MAG - a.magazine, a.inventory.count('ammo'))
    if (have <= 0) return
    a.inventory.remove('ammo', have)
    a.reloadUntil = this.time + RIFLE.reloadSeconds
    a.pendingRounds = have
    a.push({ reloading: true })
  }

  /** is a prop block of this kind within `radius` of the avatar's chest? */
  isNear(a: Avatar, block: number, radius: number): boolean {
    for (const p of this.world.props.values()) {
      if (p.id === block && Math.hypot(p.x + 0.5 - a.x, p.y + 0.5 - (a.y + 0.9), p.z + 0.5 - a.z) <= radius) return true
    }
    return false
  }

  // ================================================================ night, damage, death
  private updateNight(dt: number): void {
    const dn = this.dayNight
    dn.update(dt)
    if (dn.justChanged) {
      if (dn.phase === 'night') this.scheduleNight(dn.night)
      else {
        this.zombies.burnAll()
        this.spawnTimes = []
        this.broadcastMessage(`Dawn — you survived night ${dn.night}`)
        for (const a of this.avatars.values()) this.recordRun(a)
        this.onDawn?.()
      }
    }
    while (this.spawnTimes.length && dn.time >= this.spawnTimes[0]) {
      this.spawnTimes.shift()
      const targets = [...this.avatars.values()].filter(a => a.alive).map(a => ({ x: a.x, y: a.y, z: a.z }))
      if (targets.length) this.zombies.spawnGroup(kindsForNight(dn.night), 3 + Math.floor(Math.random() * 4), targets, 28)
    }
  }

  /** Split the night's zombie count into groups of 3–6 spread over the spawn window. */
  private scheduleNight(night: number): void {
    const total = zombiesForNight(night, this.rules.zombiesFirstNight, this.rules.zombiesPerNight)
    if (total <= 0) { this.spawnTimes = []; return }
    const groups = Math.max(1, Math.round(total / 4.5))
    const window = this.rules.nightSeconds * this.rules.spawnWindow
    this.spawnTimes = Array.from({ length: groups }, (_, i) => this.dayNight.time + this.rules.spawnDelaySeconds + (i * window) / groups)
    this.broadcastMessage(`Night ${night} — they are coming`)
  }

  private hurt(a: Avatar, amount: number, poison: boolean): void {
    a.damage(amount)
    a.hurtAt = this.time
    if (poison) a.poisonUntil = this.time + POISON.seconds
    a.push({ health: a.health, hurtAt: 1, poisoned: this.time < a.poisonUntil })
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
    a.push({ dead: true, respawnIn: RESPAWN_SECONDS, magazine: 0, reloading: false, poisoned: false })
    this.recordRun(a)
  }

  private respawn(a: Avatar): void {
    a.dead = false
    a.health = AVATAR.maxHealth
    a.sinceDamage = 0
    const sp = a.spawn
    a.x = sp.x; a.y = sp.y; a.z = sp.z
    this.streamer.loadNow(sp.x, sp.z, INITIAL_LOAD_RADIUS)
    const msg = this.crates.crates.length ? 'Your loot crate is where you fell' : 'Back on your feet'
    a.push({ dead: false, health: a.health, teleport: sp, message: msg })
  }

  private recordRun(a: Avatar): void {
    if (a.userId === null) return
    this.onRun?.({ userId: a.userId, nights: this.nightsSurvived, kills: a.kills, deaths: a.deaths, seconds: Math.floor(this.dayNight.time) })
  }

  /** zombies, drops and crates that were live when the world was saved */
  private restoreLiveWorld(save: SaveData): void {
    for (const z of zombiesToRestore(save, t => this.dayNight.phaseAt(t))) {
      const zb = this.zombies.spawn(z.kind, z.x, z.y, z.z)
      zb.hp = Math.min(zb.hp, Math.max(1, z.hp))
    }
    for (const d of save.drops) this.drops.spawn(d.id, d.count, d.x, d.y, d.z, 0, 0, 0)
    for (const c of save.crates) this.crates.restore(c.x, c.y, c.z, c.items.filter((s): s is ItemStack => s !== null))
  }
}
