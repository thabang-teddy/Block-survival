/** Operating hours: the only time window in which non-admin players may be signed in. */
import { useForm } from '@inertiajs/react'
import { DAY_NAMES, type LoginWindowForm } from './types'

interface Props {
  initial: LoginWindowForm
  timezones: string[]
}

export function LoginWindowPanel({ initial, timezones }: Props) {
  const form = useForm<LoginWindowForm>(initial)
  const overnight = form.data.start > form.data.end
  const toggleDay = (d: number) =>
    form.setData('days', form.data.days.includes(d) ? form.data.days.filter(x => x !== d) : [...form.data.days, d].sort())

  return (
    <section className="admin-panel" aria-labelledby="hours-heading">
      <header>
        <h2 id="hours-heading">Operating hours</h2>
        <p>Outside these hours players cannot sign in, and anyone signed in is logged out. Admins are exempt.</p>
      </header>
      <form className="hours" onSubmit={e => { e.preventDefault(); form.put('/admin/hours', { preserveScroll: true }) }}>
        <label className="switch">
          <input type="checkbox" checked={form.data.enabled} onChange={e => form.setData('enabled', e.target.checked)} />
          <span>Limit sign-in to these hours</span>
        </label>
        <fieldset disabled={!form.data.enabled}>
          <div className="row">
            <label>From <input type="time" value={form.data.start} onChange={e => form.setData('start', e.target.value)} /></label>
            <label>Until <input type="time" value={form.data.end} onChange={e => form.setData('end', e.target.value)} /></label>
            <label>
              Time zone{' '}
              <select value={form.data.timezone} onChange={e => form.setData('timezone', e.target.value)}>
                {timezones.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </label>
          </div>
          {overnight && <p className="hint">Ends after midnight — the window belongs to the day it starts on.</p>}
          <div className="days" role="group" aria-label="Days">
            {DAY_NAMES.map((name, d) => (
              <button type="button" key={d} className={form.data.days.includes(d) ? 'on' : ''} onClick={() => toggleDay(d)}>{name}</button>
            ))}
          </div>
        </fieldset>
        {Object.values(form.errors)[0] && <p className="error">{Object.values(form.errors)[0]}</p>}
        <button type="submit" className="primary" disabled={form.processing}>{form.processing ? 'Saving…' : 'Save hours'}</button>
      </form>
    </section>
  )
}
