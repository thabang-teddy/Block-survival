/**
 * Where the other players are (issue #15): a tag over each player in view with
 * their name and distance, and one pinned to the screen edge, arrow first, for
 * each player out of view. Subscribes to its own store slice so the rest of the
 * HUD does not re-render as people move.
 */
import type { CSSProperties } from 'react'
import { useUiStore, type PlayerMarker } from '../state/uiStore'

/** an edge-pinned marker stays out of the corner panels (timer, readouts, hotbar) */
const SAFE_X = '64px'
const SAFE_TOP = '130px'
const SAFE_BOTTOM = '130px'

function place(m: PlayerMarker): CSSProperties {
  const left = `${(m.x + 1) * 50}%`
  const top = `${(1 - m.y) * 50}%`
  if (m.onScreen) return { left, top }
  return { left: `clamp(${SAFE_X}, ${left}, calc(100% - ${SAFE_X}))`, top: `clamp(${SAFE_TOP}, ${top}, calc(100% - ${SAFE_BOTTOM}))` }
}

export function PlayerMarkers() {
  const markers = useUiStore(s => s.markers)
  if (markers.length === 0) return null
  return (
    <div className="player-markers" aria-hidden>
      {markers.map(m => (
        <div key={m.id} className={`player-marker${m.onScreen ? '' : ' off'}`} style={place(m)}>
          <span className="arrow" style={{ transform: `rotate(${m.angle}deg)` }}>▲</span>
          <span className="who">{m.name}</span>
          <span className="dist">{m.distance} m</span>
        </div>
      ))}
    </div>
  )
}
