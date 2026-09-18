/**
 * Short-lived combat effects: muzzle flash light and rifle tracer lines.
 */
import * as THREE from 'three'

const FLASH_SECONDS = 0.06
const TRACER_SECONDS = 0.09

export class CombatFx {
  readonly group = new THREE.Group()
  private readonly flash = new THREE.PointLight(0xffc070, 20, 8, 2)
  private flashTimer = 0
  private readonly tracers: { line: THREE.Line; t: number }[] = []
  private readonly tracerMat = new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9 })

  constructor() {
    this.group.name = 'fx'
    this.flash.visible = false
    this.group.add(this.flash)
  }

  muzzleFlash(x: number, y: number, z: number): void {
    this.flash.position.set(x, y, z)
    this.flash.visible = true
    this.flashTimer = FLASH_SECONDS
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to])
    const line = new THREE.Line(geo, this.tracerMat.clone())
    this.group.add(line)
    this.tracers.push({ line, t: TRACER_SECONDS })
  }

  update(dt: number): void {
    if (this.flashTimer > 0) {
      this.flashTimer -= dt
      if (this.flashTimer <= 0) this.flash.visible = false
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i]
      tr.t -= dt
      ;(tr.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, tr.t / TRACER_SECONDS)
      if (tr.t <= 0) {
        this.group.remove(tr.line)
        tr.line.geometry.dispose()
        ;(tr.line.material as THREE.Material).dispose()
        this.tracers.splice(i, 1)
      }
    }
  }

  dispose(): void {
    for (const tr of this.tracers) {
      tr.line.geometry.dispose()
      ;(tr.line.material as THREE.Material).dispose()
    }
    this.tracers.length = 0
    this.tracerMat.dispose()
    this.flash.dispose()
  }
}
