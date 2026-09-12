/**
 * Phase 1 HUD: crosshair, hotbar, click-to-play overlay, debug position.
 * Health / stamina / ammo / timer arrive with their systems in later phases.
 */
import { useUiStore } from '../state/uiStore'
import { BLOCK_NAMES } from '../world/palette'
import { HOTBAR } from '../game/Game'
import './hud.css'

const label = (id: number): string => BLOCK_NAMES[id].replace('_', ' ')

export function Hud() {
  const locked = useUiStore(s => s.locked)
  const slot = useUiStore(s => s.hotbarSlot)
  const targetBlock = useUiStore(s => s.targetBlock)
  const [x, y, z] = useUiStore(s => s.position)

  return (
    <div className="hud">
      <div className="logo">BLOCK<span>SURVIVAL</span></div>
      <div className="debug">
        {x.toFixed(1)}, {y.toFixed(1)}, {z.toFixed(1)}
        {targetBlock ? ` · ${label(targetBlock)}` : ''}
      </div>
      {locked && <div className="crosshair" aria-hidden />}
      <div className="hotbar">
        {HOTBAR.map((id, i) => (
          <div key={id} className={`slot${i === slot ? ' active' : ''}`}>
            <span className="key">{i + 1}</span>
            <span className="name">{label(id)}</span>
          </div>
        ))}
      </div>
      {!locked && (
        <div className="overlay">
          <h1>Block Survival</h1>
          <p>Click to play</p>
          <ul>
            <li><b>WASD</b> move · <b>Shift</b> sprint · <b>Space</b> jump</li>
            <li><b>Left click</b> dig · <b>Right click</b> place · <b>1–9</b> block</li>
            <li><b>Esc</b> release mouse</li>
          </ul>
        </div>
      )}
    </div>
  )
}
