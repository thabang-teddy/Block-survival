/**
 * A* over "standing cells" of the voxel world: a cell a 2-block-tall walker can occupy
 * (air at y and y+1, solid at y-1). Moves are the 4 horizontal neighbours with a step
 * up of 1 (jump) or a drop of up to 3. Bounded by `maxNodes`; when the goal is not
 * reached the path to the closest explored cell is returned so a chaser still makes
 * progress (and can start breaking blocks when it is stuck).
 */
import type { World } from '../world/chunkStore'
import { isSolid } from '../world/palette'

export interface Cell {
  x: number
  y: number
  z: number
}

const DIRS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const STEPS = [0, 1, -1, -2, -3] as const
const key = (x: number, y: number, z: number): number => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512)

export function isStanding(world: World, x: number, y: number, z: number): boolean {
  return !isSolid(world.getBlock(x, y, z)) && !isSolid(world.getBlock(x, y + 1, z)) && isSolid(world.getBlock(x, y - 1, z))
}

/** Drop a point onto the standing cell it is in / above (up to 4 blocks down). */
export function standingCellAt(world: World, px: number, py: number, pz: number): Cell {
  const x = Math.floor(px)
  const z = Math.floor(pz)
  let y = Math.floor(py + 0.01)
  for (let i = 0; i < 4; i++) {
    if (isStanding(world, x, y, z)) return { x, y, z }
    y--
  }
  return { x, y: Math.floor(py), z }
}

interface Node {
  x: number
  y: number
  z: number
  g: number
  f: number
  parent: Node | null
}

/** Minimal binary heap keyed on f. */
class Heap {
  private readonly a: Node[] = []
  get size(): number { return this.a.length }
  push(n: Node): void {
    const a = this.a
    a.push(n)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p].f <= a[i].f) break
      const t = a[p]; a[p] = a[i]; a[i] = t
      i = p
    }
  }
  pop(): Node {
    const a = this.a
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l].f < a[m].f) m = l
        if (r < a.length && a[r].f < a[m].f) m = r
        if (m === i) break
        const t = a[m]; a[m] = a[i]; a[i] = t
        i = m
      }
    }
    return top
  }
}

export interface PathResult {
  /** cells to walk through, excluding the start; empty when already adjacent */
  path: Cell[]
  reached: boolean
}

export function findPath(world: World, start: Cell, goal: Cell, maxNodes = 800): PathResult {
  const h = (x: number, y: number, z: number): number => Math.abs(x - goal.x) + Math.abs(z - goal.z) + Math.abs(y - goal.y) * 0.5
  const open = new Heap()
  const best = new Map<number, number>()
  const startNode: Node = { ...start, g: 0, f: h(start.x, start.y, start.z), parent: null }
  open.push(startNode)
  best.set(key(start.x, start.y, start.z), 0)
  let closest = startNode
  let closestH = startNode.f
  let expanded = 0

  while (open.size && expanded < maxNodes) {
    const n = open.pop()
    expanded++
    const hn = h(n.x, n.y, n.z)
    if (hn < closestH) { closest = n; closestH = hn }
    // adjacent (or on) the goal cell counts as arrived
    if (Math.abs(n.x - goal.x) + Math.abs(n.z - goal.z) <= 1 && Math.abs(n.y - goal.y) <= 1) {
      return { path: unwind(n), reached: true }
    }
    for (const [dx, dz] of DIRS) {
      const nx = n.x + dx
      const nz = n.z + dz
      for (const dy of STEPS) {
        const ny = n.y + dy
        if (!isStanding(world, nx, ny, nz)) continue
        if (dy === 1 && isSolid(world.getBlock(n.x, n.y + 2, n.z))) break // no headroom to jump
        const g = n.g + 1 + (dy === 1 ? 0.5 : dy < 0 ? 0.2 * -dy : 0)
        const k = key(nx, ny, nz)
        const prev = best.get(k)
        if (prev !== undefined && prev <= g) break
        best.set(k, g)
        open.push({ x: nx, y: ny, z: nz, g, f: g + h(nx, ny, nz), parent: n })
        break // one vertical option per direction
      }
    }
  }
  return { path: unwind(closest), reached: false }
}

function unwind(n: Node): Cell[] {
  const out: Cell[] = []
  for (let c: Node | null = n; c && c.parent; c = c.parent) out.push({ x: c.x, y: c.y, z: c.z })
  return out.reverse()
}
