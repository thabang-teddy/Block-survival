/**
 * The updraft shafts (issue #12): one additive, translucent cylinder per shaft within
 * the streamed radius, with a band texture scrolling upward so the lift reads as motion.
 * Shafts are queried from the terrain generator around the camera; they appear and
 * disappear with the streamed world.
 */
import * as THREE from 'three'
import { CHUNK } from '../world/chunkStore'
import { LOAD_RADIUS } from '../world/chunkStreamer'
import type { TerrainGenerator } from '../world/terrainGen'
import type { Updraft } from '../world/updraft'

const REFRESH_SECONDS = 0.5
/** shafts are looked up this far around the camera (a chunk past the streamed radius) */
const RANGE = (LOAD_RADIUS + 1) * CHUNK
const COLOUR = 0x8ef0ff
const OPACITY = 0.32
const SCROLL_PER_SECOND = 0.25
const SEGMENTS = 20

/** a vertical band pattern; scrolled along v it looks like air streaming upward */
function bandTexture(): THREE.Texture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = 8
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 0, size)
  grad.addColorStop(0, 'rgba(255,255,255,0.05)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.05)')
  grad.addColorStop(0.5, 'rgba(255,255,255,1)')
  grad.addColorStop(0.7, 'rgba(255,255,255,0.15)')
  grad.addColorStop(1, 'rgba(255,255,255,0.05)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 8, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  return tex
}

export class UpdraftRenderer {
  readonly group = new THREE.Group()
  private readonly terrain: TerrainGenerator
  private readonly meshes = new Map<string, THREE.Mesh>()
  private readonly material: THREE.MeshBasicMaterial
  private readonly texture: THREE.Texture
  private timer = REFRESH_SECONDS

  constructor(terrain: TerrainGenerator) {
    this.terrain = terrain
    this.group.name = 'updrafts'
    this.texture = bandTexture()
    this.material = new THREE.MeshBasicMaterial({
      color: COLOUR,
      map: this.texture,
      transparent: true,
      opacity: OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // visible from the spawn pad even when the island above is deep in the fog
      fog: false,
    })
  }

  update(dt: number, cameraX: number, cameraZ: number): void {
    this.texture.offset.y -= SCROLL_PER_SECOND * dt
    this.timer += dt
    if (this.timer < REFRESH_SECONDS) return
    this.timer = 0
    this.sync(this.terrain.updraftsNear(cameraX - RANGE, cameraZ - RANGE, cameraX + RANGE, cameraZ + RANGE))
  }

  dispose(): void {
    for (const m of this.meshes.values()) this.remove(m)
    this.meshes.clear()
    this.material.dispose()
    this.texture.dispose()
  }

  private sync(shafts: readonly Updraft[]): void {
    const wanted = new Set<string>()
    for (const u of shafts) {
      const key = `${u.ix},${u.iz}`
      wanted.add(key)
      if (this.meshes.has(key)) continue
      const height = u.topY - u.bottomY
      const geometry = new THREE.CylinderGeometry(u.radius, u.radius, height, SEGMENTS, 1, true)
      const mesh = new THREE.Mesh(geometry, this.material)
      mesh.position.set(u.x, u.bottomY + height / 2, u.z)
      mesh.frustumCulled = true
      this.meshes.set(key, mesh)
      this.group.add(mesh)
    }
    for (const [key, mesh] of this.meshes) {
      if (wanted.has(key)) continue
      this.remove(mesh)
      this.meshes.delete(key)
    }
  }

  private remove(mesh: THREE.Mesh): void {
    this.group.remove(mesh)
    mesh.geometry.dispose()
  }
}
