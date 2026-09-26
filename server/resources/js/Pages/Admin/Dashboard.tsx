/** Admin overview: what needs attention, and a card per section. */
import { Link, usePage } from '@inertiajs/react'
import { AdminLayout } from '../../ui/admin/AdminLayout'
import { DAY_NAMES } from '../../ui/admin/types'
import type { AdminDashboardProps } from '../../net/pageProps'
import { formatTime, timeAgo } from '../../game/score'

export default function Dashboard() {
  const { counts, loginWindow, windowOpen, globalWorlds, hostKeys } = usePage<AdminDashboardProps>().props
  const hours = loginWindow.enabled
    ? `${loginWindow.start}–${loginWindow.end} on ${loginWindow.days.map(d => DAY_NAMES[d]).join(', ') || 'no days'} (${loginWindow.timezone})`
    : 'no limit — players can sign in any time'

  return (
    <AdminLayout title="Overview" refresh={['counts', 'windowOpen', 'globalWorlds', 'hostKeys']}>
      <div className="cards">
        <Link href="/admin/devices" className={`card${counts.pendingDevices > 0 ? ' attention' : ''}`}>
          <b>{counts.pendingDevices}</b>
          <span>{counts.pendingDevices === 1 ? 'PC waiting' : 'PCs waiting'} for approval</span>
          <small>{counts.approvedDevices} approved</small>
        </Link>
        <Link href="/admin/users" className="card">
          <b>{counts.users}</b>
          <span>players</span>
          <small>{counts.disabledUsers} disabled</small>
        </Link>
        <Link href="/admin/hours" className={`card${loginWindow.enabled && !windowOpen ? ' attention' : ''}`}>
          <b>{loginWindow.enabled ? (windowOpen ? 'Open' : 'Closed') : 'Always'}</b>
          <span>operating hours</span>
          <small>{hours}</small>
        </Link>
        <Link href="/admin/rooms" className="card">
          <b>{counts.rooms}</b>
          <span>live {counts.rooms === 1 ? 'room' : 'rooms'}</span>
          <small>hosted games right now</small>
        </Link>
      </div>
      <section className="admin-panel narrow" aria-labelledby="global-heading">
        <header>
          <h2 id="global-heading">Global worlds</h2>
          <p>
            {globalWorlds.length === 0
              ? 'No global worlds yet — create a host key to set one up.'
              : `${globalWorlds.filter(w => w.state === 'online').length} of ${globalWorlds.length} online · ${globalWorlds.reduce((n, w) => n + w.online, 0)} playing now.`}
          </p>
        </header>
        <ul className="world-list">
          {globalWorlds.map(w => (
            <li key={w.id}>
              <b>{w.name}</b> <span className={`host-state ${w.state}`}>{w.state}</span>{' '}
              {w.state !== 'offline' && `${w.online}/4 · `}
              {w.save ? `night ${w.save.night} · ${formatTime(w.save.seconds)} survived · saved ${timeAgo(w.save.updated_at)}` : 'not played yet'}
            </li>
          ))}
        </ul>
        <Link href="/admin/pc-hosts" className="link">Manage {hostKeys} host {hostKeys === 1 ? 'key' : 'keys'} →</Link>
      </section>
    </AdminLayout>
  )
}
