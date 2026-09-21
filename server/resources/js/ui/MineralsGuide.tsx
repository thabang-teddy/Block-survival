/**
 * The minerals guide (issue #25): the in-game answer to "where do I find this?".
 * Every ore, the depth band it lives in, the pickaxe it takes and what it is for,
 * with the band you are standing in called out so the table reads as a map.
 */
import { useUiStore } from '../state/uiStore'
import { depthBand, depthNote, ORES, type OreDef } from '../world/ores'
import { BLOCK_DEFS, type BlockId } from '../world/palette'
import { getItem } from '../items/registry'
import { ItemIcon, cssColour } from './ItemIcon'

/** the pickaxe each tier names, for the "needs" column */
const TIER_NAME: Readonly<Record<number, string>> = {
  1: 'wooden', 2: 'stone', 3: 'copper', 4: 'iron', 5: 'diamond',
}

const inBand = (o: OreDef, y: number): boolean => y >= o.minY && y <= o.maxY

export function MineralsGuide() {
  const [, y] = useUiStore(s => s.position)
  const surfaceY = useUiStore(s => s.surfaceY)
  const depth = Math.round(y)
  return (
    <div className="minerals">
      <p className="depth-line">
        You are at <b>y {depth}</b>, {depthNote(y, surfaceY)} — <b>{depthBand(depth)}</b>. Bedrock is
        y 0, the sea is y 32. Dig down, or follow a cave: ore shows in tunnel walls.
      </p>
      <table className="ore-table">
        <thead>
          <tr><th /><th>Mineral</th><th>Depth</th><th>Needs</th><th>Where it is</th></tr>
        </thead>
        <tbody>
          {ORES.map(o => {
            const here = inBand(o, depth)
            return (
              <tr key={o.drop} className={here ? 'here' : ''}>
                <td>
                  <span
                    className="icon block"
                    style={{
                      background: cssColour(BLOCK_DEFS[o.block as BlockId].colours[0]),
                      borderColor: cssColour(BLOCK_DEFS[o.block as BlockId].colours[0], 0.6),
                    }}
                  />
                </td>
                <td className="ore-name">{o.drop}</td>
                <td className="band">y {o.minY}–{o.maxY}{here && <span className="here-tag">here</span>}</td>
                <td className="needs">{TIER_NAME[o.tier]}</td>
                <td className="note">{o.note}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="hint">
        <ItemIcon def={getItem('prospector')} /> A <b>prospector</b> (lapis, redstone and iron at a
        workbench) marks the nearest veins of one mineral on screen — hold it and <b>right-click</b> to
        tune it. Two emeralds attune it to twice the range.
      </p>
    </div>
  )
}
