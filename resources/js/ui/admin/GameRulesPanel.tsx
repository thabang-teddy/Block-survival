/** The day/night clock and the zombie schedule, as the admin sets them (App\Support\GameRules). */
import { useForm } from '@inertiajs/react'
import type { GameRulesForm } from './types'

interface Props {
  initial: GameRulesForm
  defaults: GameRulesForm
  bounds: Record<keyof GameRulesForm, [number, number]>
}

const FIELDS: { key: keyof GameRulesForm; label: string; unit: string; hint: string }[] = [
  { key: 'day_seconds', label: 'Day length', unit: 's', hint: 'from dawn to sunset' },
  { key: 'night_seconds', label: 'Night length', unit: 's', hint: 'from sunset to dawn; the zombies burn at dawn' },
  { key: 'zombies_first_night', label: 'Zombies on night 1', unit: '', hint: 'how many come the first night' },
  { key: 'zombies_per_night', label: 'More each night', unit: '', hint: 'added to the count every night after the first' },
  { key: 'spawn_delay_seconds', label: 'First group after', unit: 's', hint: 'seconds after sunset before the first group appears' },
  { key: 'spawn_window_percent', label: 'Arrive during', unit: '% of the night', hint: 'the groups are spread over this part of the night' },
]

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export function GameRulesPanel({ initial, defaults, bounds }: Props) {
  const form = useForm<GameRulesForm>(initial)
  const d = form.data
  const nights = [1, 2, 3, 5].map(n => `${n}: ${Math.max(0, d.zombies_first_night + d.zombies_per_night * (n - 1))}`)

  return (
    <section className="admin-panel" aria-labelledby="rules-heading">
      <header>
        <h2 id="rules-heading">Game rules</h2>
        <p>The clock and the zombie schedule every match runs on. Saved rules apply to matches started from now on; a running match keeps the rules it started with.</p>
      </header>
      <form className="hours rules" onSubmit={e => { e.preventDefault(); form.put('/admin/rules', { preserveScroll: true }) }}>
        <fieldset>
          <div className="row">
            {FIELDS.map(f => (
              <label key={f.key}>
                {f.label}{f.unit ? ` (${f.unit})` : ''}
                <input
                  type="number"
                  min={bounds[f.key][0]}
                  max={bounds[f.key][1]}
                  step={1}
                  value={d[f.key]}
                  onChange={e => form.setData(f.key, Number(e.target.value))}
                  title={f.hint}
                />
                <span className="hint">{f.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="hint">
          A full cycle lasts {mmss(d.day_seconds + d.night_seconds)} (day {mmss(d.day_seconds)}, night {mmss(d.night_seconds)}).
          Zombies per night — {nights.join(' · ')}.
        </p>
        {Object.values(form.errors)[0] && <p className="error">{Object.values(form.errors)[0]}</p>}
        <div className="form-actions">
          <button type="submit" className="primary" disabled={form.processing}>{form.processing ? 'Saving…' : 'Save rules'}</button>
          <button type="button" onClick={() => form.setData({ ...defaults })}>Reset to defaults</button>
        </div>
      </form>
    </section>
  )
}
