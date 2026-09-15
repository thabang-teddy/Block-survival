/** Rooms currently open, with a force-close for the ones whose host wandered off. */
import { router } from '@inertiajs/react'
import { when, type AdminRoom } from './types'

interface Props {
  rooms: AdminRoom[]
}

export function RoomsPanel({ rooms }: Props) {
  const close = (code: string) => {
    if (confirm(`Close room ${code}? Everyone in it is dropped.`)) router.delete(`/admin/rooms/${code}`, { preserveScroll: true })
  }

  return (
    <section className="admin-panel" aria-labelledby="rooms-heading">
      <header>
        <h2 id="rooms-heading">Live rooms <span className="badge">{rooms.length}</span></h2>
        <p>Rooms expire two hours after the host last refreshed them.</p>
      </header>
      {rooms.length === 0 ? <p className="empty">No rooms open right now.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Host</th><th>World</th><th>Players</th><th>Invited</th><th>Expires</th><th /></tr></thead>
            <tbody>
              {rooms.map(r => (
                <tr key={r.code}>
                  <td className="mono code">{r.code}</td>
                  <td><b>{r.host_name}</b></td>
                  <td>{r.world_kind === 'global' ? 'global' : 'own'}</td>
                  <td className="mono">{r.players}/4</td>
                  <td className="mono">{r.invites}</td>
                  <td>{when(r.expires_at)}</td>
                  <td className="actions"><button className="danger" onClick={() => close(r.code)}>Close</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
