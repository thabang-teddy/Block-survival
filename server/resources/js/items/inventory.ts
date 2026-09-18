/**
 * 36-slot inventory: slots 0–8 are the hotbar, 9–35 the backpack.
 */
import { getItem } from './registry'

export interface ItemStack {
  id: string
  count: number
}

export const HOTBAR_SIZE = 9
export const INVENTORY_SIZE = 36

export class Inventory {
  private readonly slots: (ItemStack | null)[] = new Array(INVENTORY_SIZE).fill(null)
  /** bumped on every change so the UI can cheaply detect it */
  version = 0

  get(slot: number): ItemStack | null {
    return this.slots[slot] ?? null
  }

  /** read-only view of the hotbar */
  hotbar(): readonly (ItemStack | null)[] {
    return this.slots.slice(0, HOTBAR_SIZE)
  }

  all(): readonly (ItemStack | null)[] {
    return this.slots.slice()
  }

  count(id: string): number {
    let n = 0
    for (const s of this.slots) if (s?.id === id) n += s.count
    return n
  }

  /** Add items; returns how many did not fit. */
  add(id: string, count: number): number {
    const max = getItem(id).maxStack
    let left = count
    for (let i = 0; i < INVENTORY_SIZE && left > 0; i++) {
      const s = this.slots[i]
      if (s && s.id === id && s.count < max) {
        const take = Math.min(max - s.count, left)
        this.slots[i] = { id, count: s.count + take }
        left -= take
      }
    }
    for (let i = 0; i < INVENTORY_SIZE && left > 0; i++) {
      if (this.slots[i]) continue
      const take = Math.min(max, left)
      this.slots[i] = { id, count: take }
      left -= take
    }
    if (left !== count) this.version++
    return left
  }

  /** Remove up to `count` from one slot; returns how many were removed. */
  takeFromSlot(slot: number, count: number): number {
    const s = this.slots[slot]
    if (!s) return 0
    const n = Math.min(count, s.count)
    this.slots[slot] = s.count - n > 0 ? { id: s.id, count: s.count - n } : null
    this.version++
    return n
  }

  /** Remove `count` of an item from anywhere; returns false (and changes nothing) if short. */
  remove(id: string, count: number): boolean {
    if (this.count(id) < count) return false
    let left = count
    for (let i = INVENTORY_SIZE - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i]
      if (s?.id !== id) continue
      const n = Math.min(s.count, left)
      this.slots[i] = s.count - n > 0 ? { id, count: s.count - n } : null
      left -= n
    }
    this.version++
    return true
  }

  /** Replace every slot (client mirror of the host's copy). */
  replace(slots: readonly (ItemStack | null)[]): void {
    for (let i = 0; i < INVENTORY_SIZE; i++) this.slots[i] = slots[i] ? { ...slots[i]! } : null
    this.version++
  }

  swap(a: number, b: number): void {
    const tmp = this.slots[a]
    this.slots[a] = this.slots[b]
    this.slots[b] = tmp
    this.version++
  }
}
