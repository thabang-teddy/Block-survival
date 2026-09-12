/**
 * Placed props (torch, workbench, bed) as GLB instances, diffed against the world's
 * prop map whenever it changes. Torches share a pool of point lights: only the
 * MAX_LIGHTS nearest the camera get a real light, the rest rely on the emissive flame.
 */
import * as THREE from 'three'
import { BLOCK } from '../world/palette'
import type { PropMeta, World } from '../world/chunkStore'
import { loadModel } from './assets'

export const MAX_LIGHTS = 12
const LIGHT_REASSIGN_SECONDS = 0.25
const TORCH_LIGHT = { colour: 0xffb060, intensity: 14, distance: 10, decay: 2 } as const

const MODELS: Readonly<Record<number, string>> = {
  [BLOCK.torch]: '/assets/Assets/Torch.glb',
  [BLOCK.workbench]: '/assets/Assets/Workbench.glb',
  [BLOCK.bed]: '/assets/Assets/Bed.glb',
}

/** Model transform for a prop cell (origin = bottom centre of the model). */
export function propTransform(meta: PropMeta): { x: number; y: number; z: number; yaw: number; scale: number } {
  const dx = Math.round(Math.sin(meta.yaw))
  const dz = Math.round(Math.cos(meta.yaw))
  switch (meta.id) {
    case BLOCK.torch:
      return { x: meta.x + 0.5, y: meta.y, z: meta.z + 0.5, yaw: 0, scale: 0.55 }
    case BLOCK.bed:
      // model spans z -1..1 with the pillow at -z; the primary (head) cell is meta, the foot is +dir
      return { x: meta.x + 0.5 + dx * 0.5, y: meta.y, z: meta.z + 0.5 + dz * 0.5, yaw: meta.yaw, scale: 1 }
    default:
      return { x: meta.x + 0.5, y: meta.y, z: meta.z + 0.5, yaw: meta.yaw, scale: 1 }
  }
}

export class PropRenderer {
  readonly group = new THREE.Group()
  private readonly world: World
  private readonly instances = new Map<string, THREE.Group>()
  private readonly lights: THREE.PointLight[] = []
  private seenVersion = -1
  private lightTimer = 0

  constructor(world: World) {
    this.world = world
    this.group.name = 'props'
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight(TORCH_LIGHT.colour, TORCH_LIGHT.intensity, TORCH_LIGHT.distance, TORCH_LIGHT.decay)
      l.visible = false
      this.lights.push(l)
      this.group.add(l)
    }
  }

  update(dt: number, cameraX: number, cameraY: number, cameraZ: number): void {
    if (this.world.propsVersion !== this.seenVersion) {
      this.seenVersion = this.world.propsVersion
      this.sync()
      this.lightTimer = LIGHT_REASSIGN_SECONDS
    }
    this.lightTimer += dt
    if (this.lightTimer >= LIGHT_REASSIGN_SECONDS) {
      this.lightTimer = 0
      this.assignLights(cameraX, cameraY, cameraZ)
    }
  }

  dispose(): void {
    for (const g of this.instances.values()) this.group.remove(g)
    this.instances.clear()
    for (const l of this.lights) l.dispose()
  }

  private sync(): void {
    const wanted = new Set<string>()
    for (const [key, meta] of this.world.props) {
      if (!meta.primary || !MODELS[meta.id]) continue
      wanted.add(key)
      if (this.instances.has(key)) continue
      const holder = new THREE.Group()
      const t = propTransform(meta)
      holder.position.set(t.x, t.y, t.z)
      holder.rotation.y = t.yaw
      holder.scale.setScalar(t.scale)
      this.instances.set(key, holder)
      this.group.add(holder)
      loadModel(MODELS[meta.id]).then(m => {
        if (this.instances.get(key) === holder) holder.add(m)
      })
    }
    for (const [key, holder] of this.instances) {
      if (wanted.has(key)) continue
      this.group.remove(holder)
      this.instances.delete(key)
    }
  }

  private assignLights(cx: number, cy: number, cz: number): void {
    const torches: { d: number; meta: PropMeta }[] = []
    for (const meta of this.world.props.values()) {
      if (meta.id !== BLOCK.torch) continue
      torches.push({ d: Math.hypot(meta.x + 0.5 - cx, meta.y + 0.7 - cy, meta.z + 0.5 - cz), meta })
    }
    torches.sort((a, b) => a.d - b.d)
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = this.lights[i]
      const t = torches[i]
      if (!t) {
        l.visible = false
        continue
      }
      l.position.set(t.meta.x + 0.5, t.meta.y + 0.75, t.meta.z + 0.5)
      l.visible = true
    }
  }

  /** number of lights currently on (for tests / debugging) */
  get activeLights(): number {
    return this.lights.filter(l => l.visible).length
  }
}
