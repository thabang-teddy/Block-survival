/**
 * Host keys (docs/pc-host-research.md §8): one per global world, each run by a PC. The
 * token is shown once when a key is created or rotated; afterwards only its fingerprint
 * (the start of its hash) tells keys apart. A paused world never ends by itself, so a
 * PC that will not be back soon is marked offline here.
 */
import { useState, type FormEvent } from 'react'
import { router, usePage } from '@inertiajs/react'
import type { AdminProps } from '../../net/pageProps'
import { when, type AdminHostKey } from './types'
import { formatTime, timeAgo } from '../../game/score'
import { seedTag } from '../../world/seed'

const STATE_TEXT: Record<AdminHostKey['state'], string> = {
  online: 'Online',
  paused: 'Paused — waiting for its PC',
  offline: 'Offline',
}

const opts = { preserveScroll: true }

export function HostKeysPanel({ hosts }: { hosts: AdminHostKey[] }) {
  const { flash } = usePage<AdminProps>().props
  const [name, setName] = useState('Host PC')
  const [seed, setSeed] = useState('')

  const create = (e: FormEvent) => {
    e.preventDefault()
    router.post('/admin/pc-hosts', { name, seed: seed === '' ? null : Number(seed) }, { ...opts, onSuccess: () => setSeed('') })
  }
  const rotate = (h: AdminHostKey) => {
    if (confirm(`Issue a new token for ${h.name}? Its PC stops working until you give it the new one.`)) router.post(`/admin/pc-hosts/${h.id}/token`, {}, opts)
  }
  const toggle = (h: AdminHostKey) => {
    if (!h.enabled || confirm(`Disable ${h.name}? Its world closes and its PC is refused until you enable it again.`)) {
      router.patch(`/admin/pc-hosts/${h.id}`, { enabled: !h.enabled }, opts)
    }
  }
  const offline = (h: AdminHostKey) => {
    if (confirm(`Mark ${h.name} offline? Players waiting for it go back to the lobby. If its PC is still running, the world opens again on its next heartbeat.`)) router.post(`/admin/pc-hosts/${h.id}/offline`, {}, opts)
  }
  const reset = (h: AdminHostKey) => {
    if (confirm(`Reset ${h.name}'s world? Everyone's builds in it are deleted and its PC starts a fresh map.`)) router.delete(`/admin/pc-hosts/${h.id}/world`, opts)
  }
  const remove = (h: AdminHostKey) => {
    if (confirm(`Remove ${h.name}? Its token stops working and its world's save is deleted. This cannot be undone.`)) router.delete(`/admin/pc-hosts/${h.id}`, opts)
  }

  return (
    <section className="admin-panel" aria-labelledby="hosts-heading">
      <header>
        <h2 id="hosts-heading">Host PCs <span className="badge">{hosts.length}</span></h2>
        <p>Each key is one global world. Put its token in the Block Survival Host app on the PC that runs it; one PC can run several.</p>
      </header>
      {flash.host_token && (
        <p className="flash" role="status">
          Token (shown once — paste it into the host app): <code>{flash.host_token}</code>
        </p>
      )}
      {hosts.length === 0 ? <p className="empty">No host PCs yet. Without one, there are no global worlds to play.</p> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Key</th><th>State</th><th>World</th><th>Players</th><th>Version</th><th>Last seen</th><th>Created</th><th /></tr>
            </thead>
            <tbody>
              {hosts.map(h => (
                <tr key={h.id} className={h.enabled ? undefined : 'disabled'}>
                  <td><b>{h.name}</b></td>
                  <td className="mono" title="The start of the token's hash">{h.fingerprint}…</td>
                  <td><span className={`host-state ${h.enabled ? h.state : 'disabled'}`}>{h.enabled ? STATE_TEXT[h.state] : 'Disabled'}</span></td>
                  <td>
                    <span className="mono">{seedTag(h.seed)}</span>
                    <small className="host-save">{h.save ? `night ${h.save.night} · ${formatTime(h.save.seconds)} · saved ${timeAgo(h.save.updated_at)}` : 'not played yet'}</small>
                  </td>
                  <td className="mono">{h.state === 'offline' ? '—' : `${h.online}/4`}</td>
                  <td className="mono">{h.version ?? '—'}</td>
                  <td>{h.last_seen_at ? timeAgo(h.last_seen_at) : 'never'}</td>
                  <td>{when(h.created_at)}</td>
                  <td className="actions pc-host-actions">
                    {h.state === 'paused' && <button className="primary" onClick={() => offline(h)}>Mark offline</button>}
                    <button onClick={() => toggle(h)}>{h.enabled ? 'Disable' : 'Enable'}</button>
                    <button onClick={() => rotate(h)}>New token</button>
                    {h.save && <button onClick={() => reset(h)} disabled={h.online > 0} title={h.online > 0 ? 'Empty the world first' : undefined}>Reset world</button>}
                    <button className="danger" onClick={() => remove(h)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form onSubmit={create} className="user-form host-form">
        <label>
          Name players see
          <input value={name} maxLength={16} onChange={e => setName(e.target.value)} required />
        </label>
        <label>
          Map seed <span className="hint">(empty = random; the first world gets the classic island)</span>
          <input type="number" min={1} max={2147483647} value={seed} onChange={e => setSeed(e.target.value)} />
        </label>
        <button className="primary" type="submit">Create host key</button>
      </form>
    </section>
  )
}
