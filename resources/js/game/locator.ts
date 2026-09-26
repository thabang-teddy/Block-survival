/**
 * Finding the other players (issue #15). The world has no edge, so once players
 * split up nothing tells them where the others went. This answers that in two
 * ways: a fix (distance and bearing relative to the view) for the scoreboard,
 * and a screen position for the HUD markers, which sit on a player in view and
 * hug the screen edge pointing at one who is not.
 */

/** where another player is, relative to the local player's view */
export interface Fix {
  /** metres, straight line */
  distance: number
  /** radians relative to the view: 0 ahead, +π/2 to the right, ±π behind */
  bearing: number
  /** metres above (+) or below (−) the local player */
  dy: number
}

/** the fix as the scoreboard shows it: whole metres, the arrow in 15° steps */
export interface Where {
  distance: number
  /** degrees clockwise from ahead */
  bearing: number
  dy: number
}

/** a marker's place in normalised device coordinates (−1..1 both ways) */
export interface Marker {
  x: number
  y: number
  /** in view: the marker sits on the player; otherwise it is pinned to the edge and points */
  onScreen: boolean
  /** degrees clockwise from straight up, for the off-screen arrow */
  angle: number
}

/** how far inside the edge an off-screen marker is pinned (fraction of the half-screen) */
export const MARKER_MARGIN = 0.08
/** the scoreboard arrow is rounded to this so rows do not re-render on every step */
const BEARING_STEP_DEG = 15
/** a height difference smaller than this is not worth a hint */
const VERTICAL_HINT_M = 6

/** yaw is three.js's: 0 looks down −z, positive turns left */
export function fixOf(
  me: { x: number; y: number; z: number; yaw: number },
  other: { x: number; y: number; z: number },
): Fix {
  const dx = other.x - me.x
  const dy = other.y - me.y
  const dz = other.z - me.z
  const ahead = dx * -Math.sin(me.yaw) + dz * -Math.cos(me.yaw)
  const right = dx * Math.cos(me.yaw) + dz * -Math.sin(me.yaw)
  return { distance: Math.hypot(dx, dy, dz), bearing: Math.atan2(right, ahead), dy }
}

export function whereOf(
  me: { x: number; y: number; z: number; yaw: number },
  other: { x: number; y: number; z: number },
): Where {
  const fix = fixOf(me, other)
  const deg = (fix.bearing * 180) / Math.PI
  return {
    distance: Math.round(fix.distance),
    bearing: Math.round(deg / BEARING_STEP_DEG) * BEARING_STEP_DEG,
    dy: Math.round(fix.dy),
  }
}

/** "12 m up" / "12 m down", or nothing when the other player is roughly level */
export function verticalHint(dy: number): string {
  const abs = Math.abs(Math.round(dy))
  if (abs < VERTICAL_HINT_M) return ''
  return `${abs} m ${dy > 0 ? 'up' : 'down'}`
}

/**
 * Project a world point through a column-major view-projection matrix
 * (`THREE.Matrix4.elements`). A point outside the view is pushed out along its
 * direction from the screen centre and pinned inside `margin`. A point behind
 * the camera goes to the bottom edge, sliding to the side it is on: the cue
 * that matters there is which way to turn, not how high up they are.
 */
export function projectMarker(vp: ArrayLike<number>, x: number, y: number, z: number, margin = MARKER_MARGIN): Marker {
  const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12]
  const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13]
  const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15]
  const bound = 1 - margin
  // dividing by |w| keeps a point behind the camera on the side it really is
  const depth = Math.max(Math.abs(cw), 1e-6)
  let nx = cx / depth
  let ny = cy / depth
  if (cw > 0) {
    if (Math.abs(nx) <= bound && Math.abs(ny) <= bound) return { x: nx, y: ny, onScreen: true, angle: 0 }
  } else {
    ny = -1
  }
  const extent = Math.max(Math.abs(nx), Math.abs(ny), 1e-6)
  nx /= extent
  ny /= extent
  const angle = (Math.atan2(nx, ny) * 180) / Math.PI
  return { x: nx * bound, y: ny * bound, onScreen: false, angle }
}
