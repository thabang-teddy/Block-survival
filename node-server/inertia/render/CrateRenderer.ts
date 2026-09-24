/**
 * Draws the loot crates the CrateManager holds, each with a slight idle sway. Follows the
 * manager's list every frame.
 */
import * as THREE from 'three'
import type { LootCrate } from '../entities/crates'
import { loadModel } from './assets'

const CRATE_URL = '/assets/Assets/Crate.glb'

export class CrateRenderer {
  readonly group = new THREE.Group()
  private readonly holders = new Map<number, THREE.Group>()

  constructor() {
    this.group.name = 'crates'
  }

  update(crates: readonly LootCrate[], time: number): void {
    const seen = new Set<number>()
    for (const c of crates) {
      seen.add(c.id)
      const h = this.holders.get(c.id) ?? this.build(c)
      h.position.set(c.x, c.y, c.z)
      h.rotation.y = Math.sin(time * 0.8 + c.id) * 0.06
    }
    for (const [id, h] of this.holders) {
      if (seen.has(id)) continue
      this.group.remove(h)
      this.holders.delete(id)
    }
  }

  dispose(): void {
    for (const h of this.holders.values()) this.group.remove(h)
    this.holders.clear()
  }

  private build(crate: LootCrate): THREE.Group {
    const holder = new THREE.Group()
    this.holders.set(crate.id, holder)
    this.group.add(holder)
    loadModel(CRATE_URL).then(m => {
      if (this.holders.get(crate.id) === holder) holder.add(m)
    })
    return holder
  }
}
