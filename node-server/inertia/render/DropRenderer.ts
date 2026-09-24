/**
 * Draws the drops the DropManager holds: a model or a small block cube each, bobbing and
 * spinning. Follows the manager's list every frame, so it never has to be told about a
 * spawn or a pickup.
 */
import * as THREE from 'three'
import { BLOCK_DEFS, type BlockId } from '../world/palette'
import { getItem } from '../items/registry'
import { DROP_SIZE, type Drop } from '../entities/drops'
import { loadModel } from './assets'

const SPIN = 1.6

export class DropRenderer {
  readonly group = new THREE.Group()
  private readonly meshes = new Map<number, THREE.Object3D>()
  private readonly blockMats = new Map<number, THREE.Material>()
  private readonly cube = new THREE.BoxGeometry(DROP_SIZE, DROP_SIZE, DROP_SIZE)

  constructor() {
    this.group.name = 'drops'
  }

  update(drops: readonly Drop[], time: number): void {
    const seen = new Set<number>()
    for (const d of drops) {
      seen.add(d.id)
      const m = this.meshes.get(d.id) ?? this.build(d)
      m.position.set(d.x, d.y + 0.05 + Math.sin(time * 2 + d.id) * 0.04, d.z)
      m.rotation.y = time * SPIN + d.id
    }
    for (const [id, m] of this.meshes) {
      if (seen.has(id)) continue
      this.group.remove(m)
      this.meshes.delete(id)
    }
  }

  dispose(): void {
    for (const m of this.meshes.values()) this.group.remove(m)
    this.meshes.clear()
    this.cube.dispose()
    for (const m of this.blockMats.values()) m.dispose()
  }

  private build(d: Drop): THREE.Object3D {
    const def = getItem(d.item)
    const holder = new THREE.Group()
    this.meshes.set(d.id, holder)
    this.group.add(holder)
    if (def.model) {
      loadModel(def.model).then(m => {
        if (this.meshes.get(d.id) !== holder) return
        m.scale.setScalar(0.45)
        holder.add(m)
      })
      return holder
    }
    const mesh = new THREE.Mesh(this.cube, this.materialFor(def.block, def.colour))
    mesh.position.y = DROP_SIZE / 2
    mesh.castShadow = true
    holder.add(mesh)
    return holder
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
