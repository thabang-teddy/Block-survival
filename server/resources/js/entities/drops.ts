/**
 * Dropped items: small physics bodies that fall, settle on blocks, spin, and are
 * picked up when a player walks over them.
 */
import * as THREE from 'three'
import type { World } from '../world/chunkStore'
import { BLOCK_DEFS, type BlockId } from '../world/palette'
import { moveBox } from '../physics/aabb'
import { getItem } from '../items/registry'
import type { Inventory } from '../items/inventory'
import { loadModel } from '../render/assets'

export interface Drop {
  id: number
  item: string
  count: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  age: number
}

const SIZE = 0.3
const GRAVITY = 18
/** horizontal / vertical reach of the pickup cylinder around the player's feet */
const PICKUP_RADIUS = 1.2
const PICKUP_BELOW = 1.6
const PICKUP_ABOVE = 2.0
const PICKUP_DELAY = 0.6
const MAX_DROPS = 200
const SPIN = 1.6

export function canPickUp(d: Drop, px: number, py: number, pz: number): boolean {
  return Math.hypot(d.x - px, d.z - pz) < PICKUP_RADIUS && d.y > py - PICKUP_BELOW && d.y < py + PICKUP_ABOVE
}

export class DropManager {
  readonly group = new THREE.Group()
  readonly drops: Drop[] = []
  private readonly world: World
  private readonly meshes = new Map<number, THREE.Object3D>()
  private readonly blockMats = new Map<number, THREE.Material>()
  private readonly cube = new THREE.BoxGeometry(SIZE, SIZE, SIZE)
  private nextId = 1
  private time = 0

  constructor(world: World) {
    this.world = world
    this.group.name = 'drops'
  }

  spawn(item: string, count: number, x: number, y: number, z: number, vx = 0, vy = 2, vz = 0): Drop {
    const drop: Drop = { id: this.nextId++, item, count, x, y, z, vx, vy, vz, age: 0 }
    this.drops.push(drop)
    if (this.drops.length > MAX_DROPS) this.remove(this.drops[0])
    this.buildMesh(drop)
    return drop
  }

  /** Simulate and try to pick up into the inventory of any collector standing over a drop. */
  update(dt: number, collectors: readonly { x: number; y: number; z: number; inv: Inventory }[]): void {
    this.time += dt
    for (const d of this.drops.slice()) {
      d.age += dt
      d.vy -= GRAVITY * dt
      d.vx *= 0.9
      d.vz *= 0.9
      const box = { x: d.x - SIZE / 2, y: d.y, z: d.z - SIZE / 2, w: SIZE, h: SIZE, d: SIZE }
      const r = moveBox(this.world, box, d.vx * dt, d.vy * dt, d.vz * dt)
      d.x = r.box.x + SIZE / 2
      d.y = r.box.y
      d.z = r.box.z + SIZE / 2
      if (r.hitY) d.vy = 0
      if (d.y < -60) { this.remove(d); continue }

      if (d.age > PICKUP_DELAY) {
        let gone = false
        for (const c of collectors) {
          if (!canPickUp(d, c.x, c.y, c.z)) continue
          const left = c.inv.add(d.item, d.count)
          if (left === 0) { this.remove(d); gone = true; break }
          d.count = left
        }
        if (gone) continue
      }
      const m = this.meshes.get(d.id)
      if (m) {
        m.position.set(d.x, d.y + 0.05 + Math.sin(this.time * 2 + d.id) * 0.04, d.z)
        m.rotation.y = this.time * SPIN + d.id
      }
    }
  }

  dispose(): void {
    for (const d of this.drops.slice()) this.remove(d)
    this.cube.dispose()
    for (const m of this.blockMats.values()) m.dispose()
  }

  /** Client side: mirror the host's drop list (no physics, no pickup). */
  applySnapshot(list: readonly { id: number; item: string; x: number; y: number; z: number }[], time: number): void {
    const seen = new Set<number>()
    for (const s of list) {
      seen.add(s.id)
      let d = this.drops.find(x => x.id === s.id)
      if (!d) {
        d = { id: s.id, item: s.item, count: 1, x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, age: 1 }
        this.drops.push(d)
        this.buildMesh(d)
      }
      d.x = s.x; d.y = s.y; d.z = s.z
      const m = this.meshes.get(d.id)
      if (m) {
        m.position.set(d.x, d.y + 0.05 + Math.sin(time * 2 + d.id) * 0.04, d.z)
        m.rotation.y = time * SPIN + d.id
      }
    }
    for (const d of this.drops.slice()) if (!seen.has(d.id)) this.remove(d)
  }

  private remove(d: Drop): void {
    const i = this.drops.indexOf(d)
    if (i >= 0) this.drops.splice(i, 1)
    const m = this.meshes.get(d.id)
    if (m) {
      this.group.remove(m)
      this.meshes.delete(d.id)
    }
  }

  private buildMesh(d: Drop): void {
    const def = getItem(d.item)
    const holder = new THREE.Group()
    this.meshes.set(d.id, holder)
    this.group.add(holder)
    if (def.model) {
      loadModel(def.model).then(m => {
        if (!this.meshes.has(d.id)) return
        m.scale.setScalar(0.45)
        holder.add(m)
      })
      return
    }
    const mesh = new THREE.Mesh(this.cube, this.materialFor(def.block, def.colour))
    mesh.position.y = SIZE / 2
    mesh.castShadow = true
    holder.add(mesh)
  }

  private materialFor(block: BlockId | undefined, colour: readonly [number, number, number]): THREE.Material {
    const key = block ?? -Math.round(colour[0] * 1000 + colour[1] * 100 + colour[2] * 10)
    let mat = this.blockMats.get(key)
    if (!mat) {
      const c = block !== undefined ? BLOCK_DEFS[block].colours[1] : colour
      mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(c[0], c[1], c[2]), flatShading: true })
      this.blockMats.set(key, mat)
    }
    return mat
  }
}
