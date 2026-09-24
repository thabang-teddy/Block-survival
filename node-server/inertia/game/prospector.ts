/**
 * The prospector (issue #25): finding ore you cannot see yet.
 *
 * Issue #15 answered "where did the others go?" with a distance and a bearing; this
 * answers "where is the iron?" the same way, so the HUD can reuse the markers. The
 * scan walks the chunks already streamed in around the player and reports one fix per
 * chunk that holds the tuned ore — a vein is about eight blocks and a chunk is sixteen
 * across, so a chunk's centre of mass is the vein, near enough to walk to. A vein lying
 * across a chunk border shows as two markers a couple of metres apart; both lead to the
 * same hole, which is cheaper than clustering and reads no differently.
 *
 * It reads the live chunk data rather than asking the generator, so a vein someone has
 * already dug out stops showing, and one a player walled in still does.
 */
import { CHUNK } from '../world/chunkStore'

/** the most fixes the HUD will show at once; the nearest win */
export const MAX_FIXES = 5

/** where a pocket of ore is, relative to nothing — world coordinates */
export interface OreFix {
  /** centre of mass of the ore in one chunk */
  x: number
  y: number
  z: number
  /** how many blocks of it are in there */
  count: number
  /** metres from the player, straight line */
  distance: number
}

/** the slice of the world the scan needs (a World, or a stub in tests) */
export interface ChunkSource {
  getChunk(cx: number, cy: number, cz: number): Uint8Array | undefined
}

/**
 * Nearest pockets of `ore` within `range` of the player, nearest first.
 *
 * Cost is one pass over each loaded chunk that survives the sphere test — at range 32
 * that is at most 125 chunks of 4096 bytes, and the Game only calls it a few times a
 * second while a prospector is actually in hand.
 */
export function scanForOre(
  world: ChunkSource,
  ore: number,
  px: number, py: number, pz: number,
  range: number,
  chunksY: number,
): OreFix[] {
  const fixes: OreFix[] = []
  const r2 = range * range
  const cx0 = Math.floor((px - range) / CHUNK)
  const cx1 = Math.floor((px + range) / CHUNK)
  const cy0 = Math.max(0, Math.floor((py - range) / CHUNK))
  const cy1 = Math.min(chunksY - 1, Math.floor((py + range) / CHUNK))
  const cz0 = Math.floor((pz - range) / CHUNK)
  const cz1 = Math.floor((pz + range) / CHUNK)
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        // cheapest rejection first: the nearest corner of the chunk box to the player
        if (boxDistanceSq(px, py, pz, cx * CHUNK, cy * CHUNK, cz * CHUNK) > r2) continue
        const data = world.getChunk(cx, cy, cz)
        if (!data) continue
        let n = 0
        let sx = 0
        let sy = 0
        let sz = 0
        for (let i = 0; i < data.length; i++) {
          if (data[i] !== ore) continue
          sx += i >> 8
          sy += (i >> 4) & (CHUNK - 1)
          sz += i & (CHUNK - 1)
          n++
        }
        if (n === 0) continue
        const x = cx * CHUNK + sx / n + 0.5
        const y = cy * CHUNK + sy / n + 0.5
        const z = cz * CHUNK + sz / n + 0.5
        const distance = Math.hypot(x - px, y - py, z - pz)
        if (distance > range) continue
        fixes.push({ x, y, z, count: n, distance })
      }
    }
  }
  fixes.sort((a, b) => a.distance - b.distance)
  return fixes.length > MAX_FIXES ? fixes.slice(0, MAX_FIXES) : fixes
}

/** squared distance from a point to a CHUNK³ box with its low corner at (bx,by,bz) */
function boxDistanceSq(px: number, py: number, pz: number, bx: number, by: number, bz: number): number {
  const dx = px < bx ? bx - px : px > bx + CHUNK ? px - bx - CHUNK : 0
  const dy = py < by ? by - py : py > by + CHUNK ? py - by - CHUNK : 0
  const dz = pz < bz ? bz - pz : pz > bz + CHUNK ? pz - bz - CHUNK : 0
  return dx * dx + dy * dy + dz * dz
}
