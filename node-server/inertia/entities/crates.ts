/**
 * Loot crates: a dead player's inventory, left where they fell. Press F to take it.
 * Crates are entities (not voxels) so they never block a doorway; they settle onto
 * the first solid block below the death point. Simulation only — render/CrateRenderer.ts
 * draws them.
 */
import type { World } from '../world/chunkStore.ts'
import { isSolid } from '../world/palette.ts'
import type { Inventory, ItemStack } from '../items/inventory.ts'

export interface LootCrate {
  id: number
  x: number
  y: number
  z: number
  items: ItemStack[]
  /** number of stacks inside (mirrored crates on clients only know the count) */
  count: number
}

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
  readonly crates: LootCrate[] = []
  private readonly world: World
  private nextId = 1

  constructor(world: World) {
    this.world = world
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
    return crate
  }

  /** put a saved crate back (issue #13) */
  restore(x: number, y: number, z: number, items: readonly ItemStack[]): LootCrate {
    const crate: LootCrate = { id: this.nextId++, x, y, z, items: items.map(s => ({ ...s })), count: items.length }
    this.crates.push(crate)
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
      }
      c.count = s.items
    }
    for (const c of this.crates.slice()) if (!seen.has(c.id)) this.remove(c)
  }

  private remove(crate: LootCrate): void {
    const i = this.crates.indexOf(crate)
    if (i >= 0) this.crates.splice(i, 1)
  }
}
