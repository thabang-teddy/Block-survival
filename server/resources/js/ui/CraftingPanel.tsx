/**
 * Inventory + crafting panel (E, or F at a workbench). Recipe list on the left,
 * requirements on the right, the 36-slot inventory underneath (click a slot, then
 * another, to swap). Reads the live inventory from the game each render — the
 * store's inventoryVersion re-renders us when it changes.
 *
 * The second tab is the minerals guide (issue #25): what there is to dig up and how
 * deep it lies. It lives here because this is the screen you open when you are
 * wondering what to make next.
 */
import { useEffect, useState } from 'react'
import { useUiStore } from '../state/uiStore'
import { craftStatus, recipesFor, type Recipe } from '../items/recipes'
import { getItem } from '../items/registry'
import { HOTBAR_SIZE } from '../items/inventory'
import { ItemIcon } from './ItemIcon'
import { MineralsGuide } from './MineralsGuide'

type Tab = 'craft' | 'minerals'

export function CraftingPanel() {
  const game = useUiStore(s => s.game)
  const nearWorkbench = useUiStore(s => s.nearWorkbench)
  useUiStore(s => s.inventoryVersion) // subscribe so crafting re-renders the counts
  const recipes = recipesFor(nearWorkbench ? 'bench' : 'hand')
  const [selected, setSelected] = useState<Recipe>(recipes[0])
  const [pickedSlot, setPickedSlot] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('craft')
  // opening E after F (or walking away from the bench) must not keep a hidden recipe selected
  if (!recipes.includes(selected)) setSelected(recipes[0])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyE' || e.code === 'Escape') {
        e.preventDefault()
        game?.closePanel()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [game])

  if (!game) return null
  const inv = game.inventory
  const status = craftStatus(inv, selected, nearWorkbench)
  const out = getItem(selected.output.id)

  const onSlotClick = (i: number) => {
    if (pickedSlot === null) {
      if (inv.get(i)) setPickedSlot(i)
      return
    }
    game.moveSlot(pickedSlot, i)
    setPickedSlot(null)
  }

  return (
    <div className="panel-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) game.closePanel() }}>
      <div className="panel">
        <header>
          <h2>{nearWorkbench ? 'Workbench' : 'Crafting'}</h2>
          <div className="tabs">
            <button className={tab === 'craft' ? 'on' : ''} onClick={() => setTab('craft')}>Craft</button>
            <button className={tab === 'minerals' ? 'on' : ''} onClick={() => setTab('minerals')}>Minerals</button>
          </div>
          <span className={`bench-tag${nearWorkbench ? ' on' : ''}`}>
            {nearWorkbench ? 'workbench in reach' : 'no workbench nearby'}
          </span>
          <button className="close" onClick={() => game.closePanel()} aria-label="Close">✕</button>
        </header>

        {tab === 'minerals' ? <MineralsGuide /> : (
        <div className="craft-body">
          <ul className="recipes">
            {recipes.map(r => {
              const st = craftStatus(inv, r, nearWorkbench)
              const def = getItem(r.output.id)
              return (
                <li
                  key={r.id}
                  className={`recipe ${st}${r === selected ? ' selected' : ''}`}
                  onClick={() => setSelected(r)}
                >
                  <ItemIcon def={def} />
                  <span className="rname">{def.name}{r.output.count > 1 ? ` ×${r.output.count}` : ''}</span>
                  {r.bench && <span className="bench-mark" title="needs a workbench">⚒</span>}
                </li>
              )
            })}
            {!nearWorkbench && <li className="bench-hint">Build a workbench for tools, weapons, glass, walls and torches.</li>}
          </ul>

          <section className="details">
            <div className="out">
              <ItemIcon def={out} large />
              <h3>{out.name}{selected.output.count > 1 ? ` ×${selected.output.count}` : ''}</h3>
            </div>
            <ul className="inputs">
              {selected.inputs.map(i => {
                const have = inv.count(i.id)
                return (
                  <li key={i.id} className={have >= i.count ? 'have' : 'lack'}>
                    <ItemIcon def={getItem(i.id)} />
                    <span>{getItem(i.id).name}</span>
                    <b>{have} / {i.count}</b>
                  </li>
                )
              })}
            </ul>
            <button className="craft" disabled={status !== 'ok'} onClick={() => game.craftRecipe(selected.id)}>
              {status === 'ok' ? 'Craft' : status === 'needsBench' ? 'Needs a workbench' : 'Missing materials'}
            </button>
          </section>
        </div>
        )}

        <div className="inv-grid">
          {inv.all().map((stack, i) => {
            const def = stack ? getItem(stack.id) : null
            return (
              <div
                key={i}
                className={`slot${i < HOTBAR_SIZE ? ' hot' : ''}${pickedSlot === i ? ' picked' : ''}`}
                onClick={() => onSlotClick(i)}
                title={def?.name}
              >
                {i < HOTBAR_SIZE && <span className="key">{i + 1}</span>}
                {def && <ItemIcon def={def} />}
                {stack && stack.count > 1 && <span className="count">{stack.count}</span>}
              </div>
            )
          })}
        </div>
        <p className="hint">Click a slot, then another, to move items · <b>E</b> / <b>Esc</b> close</p>
      </div>
    </div>
  )
}
