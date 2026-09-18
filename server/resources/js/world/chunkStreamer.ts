/**
 * Keeps the columns of chunks around the players loaded: nearest-first loading under a
 * per-frame time budget, unloading with hysteresis once a column is well out of range.
 * The planning is a pure function of (loaded, anchors, keep) so it can be tested alone.
 */
import { CHUNK, columnFromKey, columnKey, type World } from './chunkStore'

/** columns loaded around each player (chunks); the fog hides the edge */
export const LOAD_RADIUS = 7
/** extra chunks a column may drift out before it is unloaded */
export const UNLOAD_MARGIN = 2
/** loading stops for the frame once this much time was spent (a column is ~4 ms) */
export const LOAD_BUDGET_MS = 6
/** columns dropped per frame at most (disposal is cheap but bursty) */
const UNLOAD_PER_FRAME = 8

export interface StreamAnchor {
  x: number
  z: number
}

export interface ColumnCoord {
  cx: number
  cz: number
}

export interface StreamPlan {
  /** columns to load, nearest to an anchor first */
  load: ColumnCoord[]
  /** loaded columns now out of range (and holding nothing that must stay) */
  unload: ColumnCoord[]
}

const colKeyOf = (cx: number, cz: number): number => columnKey(cx, cz)

/** squared distance in chunks from a column's centre to the nearest anchor */
function nearestAnchorDist2(cx: number, cz: number, anchors: readonly StreamAnchor[]): number {
  let best = Infinity
  for (const a of anchors) {
    const dx = a.x / CHUNK - (cx + 0.5)
    const dz = a.z / CHUNK - (cz + 0.5)
    const d2 = dx * dx + dz * dz
    if (d2 < best) best = d2
  }
  return best
}

/**
 * Decide what to load and unload. `loaded` is the set of column keys currently resident;
 * `keep` are positions (zombies, drops) whose columns must not be unloaded.
 */
export function planStream(
  loaded: ReadonlySet<number>,
  anchors: readonly StreamAnchor[],
  keep: readonly StreamAnchor[],
  radius: number,
  margin: number,
): StreamPlan {
  const load: (ColumnCoord & { d2: number })[] = []
  const wanted = new Set<number>()
  const r2 = (radius + 0.5) * (radius + 0.5)
  for (const a of anchors) {
    const acx = Math.floor(a.x / CHUNK)
    const acz = Math.floor(a.z / CHUNK)
    for (let cx = acx - radius; cx <= acx + radius; cx++) {
      for (let cz = acz - radius; cz <= acz + radius; cz++) {
        const key = colKeyOf(cx, cz)
        if (wanted.has(key)) continue
        const d2 = nearestAnchorDist2(cx, cz, anchors)
        if (d2 > r2) continue
        wanted.add(key)
        if (!loaded.has(key)) load.push({ cx, cz, d2 })
      }
    }
  }
  load.sort((a, b) => a.d2 - b.d2)

  const keepKeys = new Set<number>()
  for (const k of keep) keepKeys.add(colKeyOf(Math.floor(k.x / CHUNK), Math.floor(k.z / CHUNK)))
  const unload: ColumnCoord[] = []
  const keepR2 = (radius + margin + 0.5) * (radius + margin + 0.5)
  for (const key of loaded) {
    if (wanted.has(key) || keepKeys.has(key)) continue
    const { cx, cz } = columnFromKey(key)
    if (nearestAnchorDist2(cx, cz, anchors) > keepR2) unload.push({ cx, cz })
  }
  return { load: load.map(({ cx, cz }) => ({ cx, cz })), unload }
}

export class ChunkStreamer {
  radius: number
  budgetMs: number
  private readonly world: World
  private readonly loaded = new Set<number>()

  constructor(world: World, opts: { radius?: number; budgetMs?: number } = {}) {
    this.world = world
    this.radius = opts.radius ?? LOAD_RADIUS
    this.budgetMs = opts.budgetMs ?? LOAD_BUDGET_MS
  }

  get loadedCount(): number {
    return this.loaded.size
  }

  /** Load every column within `radius` chunks of (x, z) now, ignoring the budget. */
  loadNow(x: number, z: number, radius: number): void {
    const plan = planStream(this.loaded, [{ x, z }], [], radius, 0)
    for (const c of plan.load) this.load(c.cx, c.cz)
  }

  /** Once per frame. */
  update(anchors: readonly StreamAnchor[], keep: readonly StreamAnchor[] = [], now = performance.now()): void {
    if (!anchors.length) return
    const plan = planStream(this.loaded, anchors, keep, this.radius, UNLOAD_MARGIN)
    for (let i = 0; i < plan.unload.length && i < UNLOAD_PER_FRAME; i++) {
      const c = plan.unload[i]
      this.world.unloadColumn(c.cx, c.cz)
      this.loaded.delete(colKeyOf(c.cx, c.cz))
    }
    const deadline = now + this.budgetMs
    for (const c of plan.load) {
      this.load(c.cx, c.cz)
      if (performance.now() >= deadline) break
    }
  }

  private load(cx: number, cz: number): void {
    this.world.loadColumn(cx, cz)
    this.loaded.add(colKeyOf(cx, cz))
  }
}
