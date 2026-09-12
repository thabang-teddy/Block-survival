/**
 * Keeps the last few host snapshots and blends the pair that brackets
 * (hostTime - INTERPOLATION_DELAY), so remote entities move smoothly at 20 Hz.
 */
import type { Snapshot, PlayerSnap, ZombieSnap, DropSnap } from './protocol'
import { INTERPOLATION_DELAY } from './protocol'

const KEEP = 6

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
/** shortest-arc angle blend */
const lerpAngle = (a: number, b: number, t: number): number => {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

export interface Interpolated {
  players: PlayerSnap[]
  zombies: ZombieSnap[]
  drops: DropSnap[]
  crates: Snapshot['crates']
  /** host time the blended state represents */
  time: number
}

export class SnapshotBuffer {
  private readonly snaps: Snapshot[] = []
  /** host time of the newest snapshot, plus local seconds elapsed since it arrived */
  private newestHostTime = 0
  private newestArrivedAt = 0

  push(snap: Snapshot, now: number): void {
    this.snaps.push(snap)
    if (this.snaps.length > KEEP) this.snaps.shift()
    this.newestHostTime = snap.time
    this.newestArrivedAt = now
  }

  get latest(): Snapshot | null {
    return this.snaps[this.snaps.length - 1] ?? null
  }

  /** Estimated current host time (local clock extrapolated from the newest snapshot). */
  hostTime(now: number): number {
    return this.newestHostTime + (now - this.newestArrivedAt)
  }

  /** State at (hostTime - delay); falls back to the newest snapshot when only one exists. */
  sample(now: number): Interpolated | null {
    if (!this.snaps.length) return null
    const target = this.hostTime(now) - INTERPOLATION_DELAY
    let a = this.snaps[0]
    let b = this.snaps[0]
    for (let i = 0; i < this.snaps.length; i++) {
      if (this.snaps[i].time <= target) a = this.snaps[i]
      if (this.snaps[i].time >= target) { b = this.snaps[i]; break }
      b = this.snaps[i]
    }
    const span = b.time - a.time
    const t = span > 0 ? Math.max(0, Math.min(1, (target - a.time) / span)) : 1
    return {
      time: target,
      players: blend(a.players, b.players, t, p => p.id, blendPlayer),
      zombies: blend(a.zombies, b.zombies, t, z => z.id, blendZombie),
      drops: blend(a.drops, b.drops, t, d => d.id, blendDrop),
      crates: b.crates,
    }
  }
}

function blend<T>(as: T[], bs: T[], t: number, key: (x: T) => string | number, mix: (a: T, b: T, t: number) => T): T[] {
  const byKey = new Map<string | number, T>()
  for (const a of as) byKey.set(key(a), a)
  // entities present in the newer snapshot win; those only in the older one have left
  return bs.map(b => {
    const a = byKey.get(key(b))
    return a ? mix(a, b, t) : b
  })
}

const blendPlayer = (a: PlayerSnap, b: PlayerSnap, t: number): PlayerSnap => ({
  ...b, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t),
  yaw: lerpAngle(a.yaw, b.yaw, t), pitch: lerp(a.pitch, b.pitch, t),
})
const blendZombie = (a: ZombieSnap, b: ZombieSnap, t: number): ZombieSnap => ({
  ...b, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), yaw: lerpAngle(a.yaw, b.yaw, t),
  attacked: b.attacked && !a.attacked,
})
const blendDrop = (a: DropSnap, b: DropSnap, t: number): DropSnap => ({
  ...b, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t),
})
