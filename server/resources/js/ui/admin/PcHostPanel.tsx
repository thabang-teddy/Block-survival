/**
 * The PC that hosts the global world (docs/pc-host-research.md §5.1): create it and copy
 * its token once, rotate or revoke the token, and release a paused world to the browsers
 * — the pause never ends by itself.
 */
import { useState, type FormEvent } from 'react'
import { router, usePage } from '@inertiajs/react'
import type { AdminProps } from '../../net/pageProps'
import type { AdminPcHost } from './types'
import { timeAgo } from '../../game/score'

const STATE_TEXT: Record<AdminPcHost['state'], string> = {
  online: 'Online — the PC hosts the global world.',
  paused: 'Paused — the global world waits for the PC to come back.',
  offline: 'Offline — browsers host the global world.',
}

export function PcHostPanel({ host }: { host: AdminPcHost | null }) {
  const { flash } = usePage<AdminProps>().props
  const [name, setName] = useState('Host PC')
  const opts = { preserveScroll: true }

  const create = (e: FormEvent) => {
    e.preventDefault()
    router.post('/admin/pc-host', { name }, opts)
  }
  const rotate = () => {
    if (confirm('Issue a new token? The PC stops working until you put the new one in its config.json.')) router.post('/admin/pc-host/token', {}, opts)
  }
  const release = () => {
    if (confirm('Release the global world to the browsers? Players stop waiting for the PC; it takes the world back once the browsers are done with it.')) router.post('/admin/pc-host/release', {}, opts)
  }
  const revoke = () => {
    if (confirm('Remove the host PC? Its token stops working and the browsers host the global world.')) router.delete('/admin/pc-host', opts)
  }

  return (
    <section className="admin-panel narrow" aria-labelledby="pc-host-heading">
      <header>
        <h2 id="pc-host-heading">Host PC</h2>
        {host ? (
          <p>
            <b>{host.name}</b>: {host.standing_by ? 'Running, standing by — it takes the world back when the browsers are done.' : STATE_TEXT[host.state]}
            {' '}
            {host.last_seen_at ? `Last heard from ${timeAgo(host.last_seen_at)}` : 'It has never connected'}
            {host.version ? ` · version ${host.version}` : ''}
            {host.state === 'online' ? ` · ${host.players} playing` : ''}.
          </p>
        ) : (
          <p>No host PC. Create one to let a PC at home host the global world; until then the players&apos; browsers host it.</p>
        )}
      </header>
      {flash.host_token && (
        <p className="flash" role="status">
          Token (shown once — put it in the PC&apos;s <code>config.json</code>): <code>{flash.host_token}</code>
        </p>
      )}
      {host ? (
        <div className="pc-host-actions">
          {host.state === 'paused' && <button className="primary" onClick={release}>Release to browsers</button>}
          <button onClick={rotate}>New token</button>
          <button className="danger" onClick={revoke}>Remove</button>
        </div>
      ) : (
        <form onSubmit={create} className="user-form">
          <label>
            Name players see
            <input value={name} maxLength={16} onChange={e => setName(e.target.value)} required />
          </label>
          <button className="primary" type="submit">Create host PC</button>
        </form>
      )}
    </section>
  )
}
