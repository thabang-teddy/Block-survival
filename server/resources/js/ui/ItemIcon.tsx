/** Item icon: colour swatch for blocks, glyph for everything else. */
import type { ItemDef } from '../items/registry'

const ICONS: Readonly<Record<string, string>> = {
  pickaxe_wood: '⛏', pickaxe_stone: '⛏', pickaxe_iron: '⛏', sword: '🗡', rifle: '🔫',
  torch: '🔥', ammo: '▮', stick: '╱', coal: '●', iron: '▣', workbench: '🛠', bed: '🛏',
  // issue #25: the rest of the minerals and what they make
  pickaxe_copper: '⛏', pickaxe_gold: '⛏', pickaxe_diamond: '⛏', sword_diamond: '🗡',
  copper: '▣', gold: '▣', redstone: '✦', lapis: '✦', diamond: '◆', emerald: '◆',
  prospector: '◎', prospector_tuned: '◎', prospector_far: '◎',
}

export const cssColour = (c: readonly [number, number, number], mul = 1): string =>
  `rgb(${Math.round(c[0] * 255 * mul)} ${Math.round(c[1] * 255 * mul)} ${Math.round(c[2] * 255 * mul)})`

export function ItemIcon({ def, large = false }: { def: ItemDef; large?: boolean }) {
  const cls = large ? ' large' : ''
  if (def.kind === 'block') {
    return (
      <span
        className={`icon block${cls}`}
        style={{ background: cssColour(def.colour), borderColor: cssColour(def.colour, 0.6) }}
      />
    )
  }
  return <span className={`icon glyph${cls}`} style={{ color: cssColour(def.colour, 1.2) }}>{ICONS[def.id] ?? '?'}</span>
}
