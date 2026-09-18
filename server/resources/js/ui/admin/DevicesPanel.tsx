/** Browsers waiting for approval, then the approved ones. Removing a device revokes it. */
import { useState } from 'react'
import { router } from '@inertiajs/react'
import { browserName, when, type AdminDevice } from './types'

interface Props {
  devices: AdminDevice[]
}

export function DevicesPanel({ devices }: Props) {
  const pending = devices.filter(d => !d.approved_at)
  const approved = devices.filter(d => d.approved_at)

  return (
    <section className="admin-panel" aria-labelledby="devices-heading">
      <header>
        <h2 id="devices-heading">PCs {pending.length > 0 && <span className="badge">{pending.length} waiting</span>}</h2>
        <p>A PC that signs in for the first time waits here until you approve it. Removing an approved PC signs it out; its next sign-in comes back as a new request.</p>
      </header>
      {pending.length > 0 && <DeviceTable devices={pending} pending />}
      {approved.length > 0 ? <DeviceTable devices={approved} /> : <p className="empty">No approved PCs yet.</p>}
    </section>
  )
}

function DeviceTable({ devices, pending = false }: { devices: AdminDevice[]; pending?: boolean }) {
  return (
    <div className="table-wrap">
      <table className={pending ? 'pending' : ''}>
        <thead>
          <tr><th>#</th><th>Player</th><th>Browser</th><th>IP</th><th>{pending ? 'Asked' : 'Last seen'}</th><th>Label</th><th /></tr>
        </thead>
        <tbody>
          {devices.map(d => <DeviceRow key={d.id} device={d} pending={pending} />)}
        </tbody>
      </table>
    </div>
  )
}

function DeviceRow({ device: d, pending }: { device: AdminDevice; pending: boolean }) {
  const [label, setLabel] = useState(d.label ?? '')
  const saveLabel = () => {
    if (label !== (d.label ?? '')) router.patch(`/admin/devices/${d.id}`, { label }, { preserveScroll: true })
  }
  const remove = () => {
    if (confirm(pending ? `Reject device #${d.id}?` : `Sign out and forget device #${d.id}?`)) {
      router.delete(`/admin/devices/${d.id}`, { preserveScroll: true })
    }
  }

  return (
    <tr>
      <td className="mono">{d.id}</td>
      <td>{d.user ? <><b>{d.user.name}</b><small>{d.user.email}</small></> : <i>never signed in</i>}</td>
      <td title={d.user_agent ?? ''}>{browserName(d.user_agent)}</td>
      <td className="mono">{d.ip ?? '—'}</td>
      <td>{when(pending ? d.first_seen_at : d.last_seen_at)}</td>
      <td><input value={label} maxLength={40} placeholder="e.g. living room PC" onChange={e => setLabel(e.target.value)} onBlur={saveLabel} /></td>
      <td className="actions">
        {pending && <button className="primary" onClick={() => router.post(`/admin/devices/${d.id}/approve`, {}, { preserveScroll: true })}>Approve</button>}
        <button className="danger" onClick={remove}>{pending ? 'Reject' : 'Remove'}</button>
      </td>
    </tr>
  )
}
