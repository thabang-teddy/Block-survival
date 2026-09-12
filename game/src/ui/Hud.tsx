/**
 * HUD: logo, health/stamina bars, ammo, hotbar, crosshair with break progress,
 * click-to-play overlay. All React DOM over the canvas; state comes from the UI store.
 */
import { useUiStore } from '../state/uiStore'
import { BLOCK_NAMES } from '../world/palette'
import { getItem, type ItemDef } from '../items/registry'
import type { ItemStack } from '../items/inventory'
import './hud.css'

const ICONS: Readonly<Record<string, string>> = {
  pickaxe_wood: '⛏', pickaxe_stone: '⛏', pickaxe_iron: '⛏', sword: '🗡', rifle: '🔫',
  torch: '🔥', ammo: '▮', stick: '╱', coal: '●', iron: '▣', workbench: '🛠', bed: '🛏',
}

const css = (c: readonly [number, number, number], mul = 1): string =>
  `rgb(${Math.round(c[0] * 255 * mul)} ${Math.round(c[1] * 255 * mul)} ${Math.round(c[2] * 255 * mul)})`

function ItemIcon({ def }: { def: ItemDef }) {
  if (def.kind === 'block') {
    return <span className="icon block" style={{ background: css(def.colour), borderColor: css(def.colour, 0.6) }} />
  }
  return <span className="icon glyph" style={{ color: css(def.colour, 1.2) }}>{ICONS[def.id] ?? '?'}</span>
}

function Slot({ stack, index, active }: { stack: ItemStack | null; index: number; active: boolean }) {
  const def = stack ? getItem(stack.id) : null
  return (
    <div className={`slot${active ? ' active' : ''}`} title={def?.name}>
      <span className="key">{index + 1}</span>
      {def && <ItemIcon def={def} />}
      {stack && stack.count > 1 && <span className="count">{stack.count}</span>}
      {def && active && <span className="name">{def.name}</span>}
    </div>
  )
}

function Bar({ kind, value, max }: { kind: 'health' | 'stamina'; value: number; max: number }) {
  return (
    <div className={`bar ${kind}`}>
      <span className="bar-icon">{kind === 'health' ? '♥' : '»'}</span>
      <div className="track"><div className="fill" style={{ width: `${(100 * value) / max}%` }} /></div>
      <span className="value">{Math.round(value)}</span>
    </div>
  )
}

export function Hud() {
  const locked = useUiStore(s => s.locked)
  const slot = useUiStore(s => s.hotbarSlot)
  const hotbar = useUiStore(s => s.hotbar)
  const targetBlock = useUiStore(s => s.targetBlock)
  const [x, y, z] = useUiStore(s => s.position)
  const health = useUiStore(s => s.health)
  const stamina = useUiStore(s => s.stamina)
  const ammo = useUiStore(s => s.ammo)
  const cameraMode = useUiStore(s => s.cameraMode)
  const breakProgress = useUiStore(s => s.breakProgress)
  const canBreak = useUiStore(s => s.canBreak)

  return (
    <div className="hud">
      <div className="logo">BLOCK<span>SURVIVAL</span></div>
      <div className="debug">
        {x.toFixed(1)}, {y.toFixed(1)}, {z.toFixed(1)}
        {targetBlock ? ` · ${BLOCK_NAMES[targetBlock].replace('_', ' ')}${canBreak ? '' : ' (needs pickaxe)'}` : ''}
        {` · ${cameraMode === 'first' ? '1st' : '3rd'} person (V)`}
      </div>

      <div className="vitals">
        <Bar kind="health" value={health} max={100} />
        <Bar kind="stamina" value={stamina} max={100} />
      </div>

      {ammo && (
        <div className="ammo">
          <span className="mag">{ammo.mag}</span>
          <span className="sep">/</span>
          <span className="reserve">{ammo.reserve}</span>
          <span className="mag-icon">▮</span>
        </div>
      )}

      {locked && (
        <div className="crosshair" aria-hidden>
          {breakProgress > 0 && (
            <div className="break-ring" style={{ background: `conic-gradient(#fff ${breakProgress * 360}deg, transparent 0)` }} />
          )}
        </div>
      )}

      <div className="hotbar">
        {hotbar.map((stack, i) => <Slot key={i} stack={stack} index={i} active={i === slot} />)}
      </div>

      {!locked && (
        <div className="overlay">
          <h1>Block Survival</h1>
          <p>Click to play</p>
          <ul>
            <li><b>WASD</b> move · <b>Shift</b> sprint · <b>Space</b> jump · <b>V</b> camera</li>
            <li><b>Hold left</b> dig / swing · <b>Right</b> place · <b>1–9</b> select · <b>Q</b> drop</li>
            <li><b>R</b> reload · <b>Esc</b> release mouse</li>
          </ul>
        </div>
      )}
    </div>
  )
}
