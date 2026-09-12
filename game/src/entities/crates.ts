/**
 * Loot crates: a dead player's inventory, left where they fell. Press F to take it.
 * Crates are entities (not voxels) so they never block a doorway; they settle onto
 * the first solid block below the death point.
 */
import * as THREE from 'three'
import type { World } from '../world/chunkStore'
import { isSolid } from '../world/palette'
import type { Inventory, ItemStack } from '../items/inventory'
import { loadModel } from '../render/assets'

export interface LootCrate {
  id: number
  x: number
  y: number
  z: number
  items: ItemStack[]
  /** number of stacks inside (mirrored crates on clients only know the count) */
  count: number
}

const CRATE_URL = '/assets/Assets/Crate.glb'
/** how far down to look for ground under the death point */
const SETTLE_DEPTH = 24
export const LOOT_REACH = 3.5
/** cosine of the half-angle the player must be looking within to target a crate */
const LOOT_ARC = Math.cos(Math.PI / 8)

/** Move a point down to rest on the nearest solid block below (or return it unchanged). */
export function settle(world: World, x: number, y: number, z: number): { x: number; y: number; z: number } {
  const bx = Math.floor(x)
  const bz = Math.floor(z)
  let by = Math.floor(y)
  for (let i = 0; i < SETTLE_DEPTH; i++, by--) {
    if (isSolid(world.getBlock(bx, by - 1, bz))) return { x: bx + 0.5, y: by, z: bz + 0.5 }
  }
  return { x, y, z }
}

export class CrateManager {
  readonly group = new THREE.Group()
  readonly crates: LootCrate[] = []
  private readonly world: World
  private readonly holders = new Map<number, THREE.Group>()
  private nextId = 1

  constructor(world: World) {
    this.world = world
    this.group.name = 'crates'
  }

  /** Drop every stack in `inv` into a new crate at the death point (nothing if empty). */
  dropInventory(inv: Inventory, x: number, y: number, z: number): LootCrate | null {
    const items: ItemStack[] = []
    inv.all().forEach((stack, i) => {
      if (!stack) return
      items.push({ ...stack })
      inv.takeFromSlot(i, stack.count)
    })
    if (!items.length) return null
    const p = settle(this.world, x, y, z)
    const crate: LootCrate = { id: this.nextId++, ...p, items, count: items.length }
    this.crates.push(crate)
    this.buildMesh(crate)
    return crate
  }

  /** The crate the player is looking at within reach, if any. */
  targeted(ex: number, ey: number, ez: number, dx: number, dy: number, dz: number): LootCrate | null {
    let best: LootCrate | null = null
    let bestD = LOOT_REACH
    for (const c of this.crates) {
      const vx = c.x - ex
      const vy = c.y + 0.5 - ey
      const vz = c.z - ez
      const d = Math.hypot(vx, vy, vz)
      if (d > bestD) continue
      const cos = (vx * dx + vy * dy + vz * dz) / (d || 1)
      if (cos < LOOT_ARC) continue
      best = c
      bestD = d
    }
    return best
  }

  /** Move as much as fits into `inv`; the crate disappears once empty. Returns items taken. */
  loot(crate: LootCrate, inv: Inventory): number {
    let taken = 0
    crate.items = crate.items.flatMap(stack => {
      const left = inv.add(stack.id, stack.count)
      taken += stack.count - left
      return left > 0 ? [{ id: stack.id, count: left }] : []
    })
    crate.count = crate.items.length
    if (!crate.items.length) this.remove(crate)
    return taken
  }

  /** Client side: mirror the host's crates. */
  applySnapshot(list: readonly { id: number; x: number; y: number; z: number; items: number }[]): void {
    const seen = new Set<number>()
    for (const s of list) {
      seen.add(s.id)
      let c = this.crates.find(x => x.id === s.id)
      if (!c) {
        c = { id: s.id, x: s.x, y: s.y, z: s.z, items: [], count: s.items }
        this.crates.push(c)
        this.buildMesh(c)
      }
      c.count = s.items
    }
    for (const c of this.crates.slice()) if (!seen.has(c.id)) this.remove(c)
  }

  update(time: number): void {
    for (const c of this.crates) {
      const h = this.holders.get(c.id)
      if (h) h.rotation.y = Math.sin(time * 0.8 + c.id) * 0.06
    }
  }

  dispose(): void {
    for (const c of this.crates.slice()) this.remove(c)
  }

  private remove(crate: LootCrate): void {
    const i = this.crates.indexOf(crate)
    if (i >= 0) this.crates.splice(i, 1)
    const h = this.holders.get(crate.id)
    if (h) {
      this.group.remove(h)
      this.holders.delete(crate.id)
    }
  }

  private buildMesh(crate: LootCrate): void {
    const holder = new THREE.Group()
    holder.position.set(crate.x, crate.y, crate.z)
    this.holders.set(crate.id, holder)
    this.group.add(holder)
    loadModel(CRATE_URL).then(m => {
      if (this.holders.get(crate.id) === holder) holder.add(m)
    })
  }
}
