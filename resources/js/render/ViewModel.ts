/**
 * First-person held item. A group parented to the camera showing the selected
 * hotbar item (tool GLB or a block cube) with walk bob and a swing animation.
 */
import * as THREE from 'three'
import { getItem } from '../items/registry'
import { BLOCK_DEFS, type BlockId } from '../world/palette'
import { loadModel } from './assets'

interface Pose {
  pos: [number, number, number]
  rot: [number, number, number]
  scale: number
}

/** Per-model resting pose in camera space (camera looks down -Z). */
const POSES: Readonly<Record<string, Pose>> = {
  Rifle: { pos: [0.24, -0.33, -0.38], rot: [0, Math.PI, 0], scale: 0.45 },
  Sword: { pos: [0.34, -0.45, -0.55], rot: [-0.7, -0.3, 0.35], scale: 0.4 },
  Pickaxe: { pos: [0.32, -0.4, -0.52], rot: [-0.45, 0.55, 0.25], scale: 0.42 },
  Torch: { pos: [0.34, -0.42, -0.5], rot: [-0.2, 0, 0.15], scale: 0.45 },
  block: { pos: [0.4, -0.34, -0.75], rot: [0.3, -0.6, 0], scale: 0.7 },
  none: { pos: [0.42, -0.45, -0.6], rot: [0, 0, 0], scale: 1 },
}

const SWING_TIME = 0.32

export class ViewModel {
  readonly group = new THREE.Group()
  private readonly anchor = new THREE.Group()
  private current: THREE.Object3D | null = null
  private currentItem: string | null | undefined = undefined
  private swingT = 1
  private bobT = 0
  private readonly cube = new THREE.BoxGeometry(0.2, 0.2, 0.2)
  private readonly mats = new Map<number, THREE.Material>()
  private loadToken = 0

  constructor() {
    this.group.name = 'viewmodel'
    this.group.add(this.anchor)
  }

  /** Switch the displayed item (no-op if unchanged). */
  setItem(itemId: string | null): void {
    if (itemId === this.currentItem) return
    this.currentItem = itemId
    const token = ++this.loadToken
    if (this.current) {
      this.anchor.remove(this.current)
      this.current = null
    }
    if (!itemId) return
    const def = getItem(itemId)
    if (def.model) {
      const name = def.model.split('/').pop()!.replace('.glb', '')
      loadModel(def.model).then(m => {
        if (token !== this.loadToken) return
        this.applyPose(m, POSES[name] ?? POSES.none)
        m.traverse(o => { o.castShadow = false })
        this.current = m
        this.anchor.add(m)
      })
      return
    }
    if (def.block !== undefined) {
      const mesh = new THREE.Mesh(this.cube, this.materialFor(def.block))
      this.applyPose(mesh, POSES.block)
      this.current = mesh
      this.anchor.add(mesh)
    }
  }

  swing(): void {
    this.swingT = 0
  }

  update(dt: number, moving: boolean, visible: boolean): void {
    this.group.visible = visible
    if (!visible) return
    this.swingT = Math.min(1, this.swingT + dt / SWING_TIME)
    this.bobT += dt * (moving ? 9 : 2.5)
    const bobAmp = moving ? 0.018 : 0.005
    const s = Math.sin(this.swingT * Math.PI)
    this.anchor.position.set(
      Math.sin(this.bobT * 0.5) * bobAmp - s * 0.08,
      Math.abs(Math.cos(this.bobT * 0.5)) * bobAmp * 0.7 - s * 0.12,
      -s * 0.1,
    )
    this.anchor.rotation.set(-s * 0.9, s * 0.25, -s * 0.35)
  }

  dispose(): void {
    this.cube.dispose()
    for (const m of this.mats.values()) m.dispose()
  }

  private applyPose(o: THREE.Object3D, p: Pose): void {
    o.position.set(...p.pos)
    o.rotation.set(...p.rot)
    o.scale.setScalar(p.scale)
  }

  private materialFor(block: BlockId): THREE.Material {
    let m = this.mats.get(block)
    if (!m) {
      const c = BLOCK_DEFS[block].colours[1]
      m = new THREE.MeshStandardMaterial({ color: new THREE.Color(c[0], c[1], c[2]), flatShading: true })
      this.mats.set(block, m)
    }
    return m
  }
}
