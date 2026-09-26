/**
 * Where the ore is (issue #25). The prospector's answer to the same question the
 * player markers answer about people: a tag over each pocket in view, and one pinned
 * to the screen edge, arrow first, for each pocket behind you. Tinted with the ore's
 * own colour so a tuned lens reads at a glance.
 */
import type { CSSProperties } from 'react'
import { useUiStore, type OreMarker } from '../state/uiStore'
import { BLOCK_DEFS, type BlockId } from '../world/palette'
import { oreOf } from '../world/ores'
import { cssColour } from './ItemIcon'

/** an edge-pinned marker stays out of the corner panels, as the player ones do */
const SAFE_X = '64px'
const SAFE_TOP = '130px'
const SAFE_BOTTOM = '130px'

function place(m: OreMarker): CSSProperties {
  const left = `${(m.x + 1) * 50}%`
  const top = `${(1 - m.y) * 50}%`
  if (m.onScreen) return { left, top }
  return { left: `clamp(${SAFE_X}, ${left}, calc(100% - ${SAFE_X}))`, top: `clamp(${SAFE_TOP}, ${top}, calc(100% - ${SAFE_BOTTOM}))` }
}

export function OreMarkers() {
  const markers = useUiStore(s => s.oreMarkers)
  const prospector = useUiStore(s => s.prospector)
  if (!prospector || markers.length === 0) return null
  const ore = oreOf(prospector.ore)
  const colour = cssColour(BLOCK_DEFS[prospector.ore as BlockId].colours[0], 1.5)
  return (
    <div className="ore-markers" aria-hidden>
      {markers.map(m => (
        <div key={m.id} className={`player-marker ore${m.onScreen ? '' : ' off'}`} style={{ ...place(m), borderColor: colour }}>
          <span className="arrow" style={{ transform: `rotate(${m.angle}deg)`, color: colour }}>▲</span>
          <span className="who" style={{ color: colour }}>{ore?.drop ?? 'ore'}</span>
          <span className="dist">{m.distance} m · {m.count}</span>
        </div>
      ))}
    </div>
  )
}
