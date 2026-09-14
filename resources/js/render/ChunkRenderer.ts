/**
 * Owns one THREE.Group of chunk meshes and rebuilds dirty chunks each frame.
 * Two materials for the whole world: opaque and translucent, both vertex-coloured.
 */
import * as THREE from 'three'
import { CHUNK, type World } from '../world/chunkStore'
import { meshChunk, type MeshData } from '../world/mesher'

const MAX_REBUILDS_PER_FRAME = 6

export class ChunkRenderer {
  readonly group = new THREE.Group()
  private readonly world: World
  private readonly meshes = new Map<string, { opaque?: THREE.Mesh; translucent?: THREE.Mesh }>()
  private readonly opaqueMat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0,
  })
  private readonly translucentMat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.25, metalness: 0,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  })
  private pending: string[] = []

  constructor(world: World) {
    this.world = world
    this.group.name = 'chunks'
  }

  /** Rebuild every chunk now (initial load). */
  buildAll(): void {
    this.world.markAllDirty()
    this.pending = this.world.takeDirty()
    while (this.pending.length) this.rebuild(this.pending.pop()!)
  }

  /** Call once per frame: rebuilds a bounded number of dirty chunks. */
  update(): void {
    for (const k of this.world.takeDirty()) if (!this.pending.includes(k)) this.pending.push(k)
    let n = 0
    while (this.pending.length && n < MAX_REBUILDS_PER_FRAME) {
      this.rebuild(this.pending.shift()!)
      n++
    }
  }

  dispose(): void {
    for (const entry of this.meshes.values()) {
      entry.opaque?.geometry.dispose()
      entry.translucent?.geometry.dispose()
    }
    this.meshes.clear()
    this.group.clear()
    this.opaqueMat.dispose()
    this.translucentMat.dispose()
  }

  private rebuild(key: string): void {
    const [cx, cy, cz] = key.split(',').map(Number)
    const data = meshChunk(this.world, cx, cy, cz)
    let entry = this.meshes.get(key)
    if (!entry) {
      entry = {}
      this.meshes.set(key, entry)
    }
    entry.opaque = this.swap(entry.opaque, data.opaque, this.opaqueMat, key, true)
    entry.translucent = this.swap(entry.translucent, data.translucent, this.translucentMat, key, false)
  }

  private swap(
    existing: THREE.Mesh | undefined,
    data: MeshData | null,
    material: THREE.Material,
    key: string,
    castShadow: boolean,
  ): THREE.Mesh | undefined {
    if (existing) {
      this.group.remove(existing)
      existing.geometry.dispose()
    }
    if (!data) return undefined
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 4))
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1))
    const [cx, cy, cz] = key.split(',').map(Number)
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3((cx + 0.5) * CHUNK, (cy + 0.5) * CHUNK, (cz + 0.5) * CHUNK),
      CHUNK * Math.SQRT2,
    )
    const mesh = new THREE.Mesh(geo, material)
    mesh.name = `chunk:${key}`
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    this.group.add(mesh)
    return mesh
  }
}
