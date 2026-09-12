/**
 * One player's authoritative state on the host: pose (mirrored from the local
 * controller or from a client's input packets), inventory, weapon, vitals, score.
 * The local player's avatar is also used on clients, filled from the host's private
 * state messages.
 */
import { Inventory } from '../items/inventory'
import type { AnimName } from './Game'
import type { PrivateState } from '../net/protocol'

export const AVATAR = {
  maxHealth: 100,
  healthRegen: 1,
  healthRegenDelay: 8,
  eyeHeight: 1.62,
} as const

export interface Spawn {
  x: number
  y: number
  z: number
}

export class Avatar {
  readonly id: string
  name: string
  // ---- pose
  x = 0
  y = 0
  z = 0
  yaw = 0
  pitch = 0
  anim: AnimName = 'Idle'
  slot = 0
  aiming = false
  // ---- gear
  readonly inventory = new Inventory()
  magazine = 0
  reloadUntil = 0
  pendingRounds = 0
  nextShotAt = 0
  // ---- vitals
  health: number = AVATAR.maxHealth
  sinceDamage = 99
  poisonUntil = 0
  hurtAt = -10
  dead = false
  respawnAt = 0
  spawn: Spawn
  // ---- score
  kills = 0
  deaths = 0
  /** private state changes waiting to be sent to this avatar's client (remote avatars only) */
  outbox: PrivateState = { t: 'state' }
  inventoryVersionSent = -1

  constructor(id: string, name: string, spawn: Spawn) {
    this.id = id
    this.name = name
    this.spawn = { ...spawn }
    this.x = spawn.x
    this.y = spawn.y
    this.z = spawn.z
  }

  get heldItem(): string | null {
    return this.inventory.get(this.slot)?.id ?? null
  }

  get alive(): boolean {
    return !this.dead
  }

  eye(): { x: number; y: number; z: number } {
    return { x: this.x, y: this.y + AVATAR.eyeHeight, z: this.z }
  }

  damage(amount: number): void {
    this.health = Math.max(0, this.health - amount)
    this.sinceDamage = 0
  }

  tickHealth(dt: number): void {
    this.sinceDamage += dt
    if (this.sinceDamage > AVATAR.healthRegenDelay && !this.dead) {
      this.health = Math.min(AVATAR.maxHealth, this.health + AVATAR.healthRegen * dt)
    }
  }

  /** queue a private-state change for the client (no-op for the host's own avatar) */
  push(patch: Omit<PrivateState, 't'>): void {
    if (patch.fx) this.outbox.fx = [...(this.outbox.fx ?? []), ...patch.fx]
    const { fx: _fx, ...rest } = patch
    Object.assign(this.outbox, rest)
  }

  takeOutbox(): PrivateState | null {
    const out = this.outbox
    const changed = Object.keys(out).length > 1
    this.outbox = { t: 'state' }
    return changed ? out : null
  }
}
