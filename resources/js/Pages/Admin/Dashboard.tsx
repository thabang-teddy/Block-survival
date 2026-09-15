/** Admin overview: what needs attention, and a card per section. */
import { Link, router, usePage } from '@inertiajs/react'
import { AdminLayout } from '../../ui/admin/AdminLayout'
import { DAY_NAMES } from '../../ui/admin/types'
import type { AdminDashboardProps } from '../../net/pageProps'
import { formatTime, timeAgo } from '../../game/score'

export default function Dashboard() {
  const { counts, loginWindow, windowOpen, globalWorld } = usePage<AdminDashboardProps>().props
  const resetGlobal = () => {
    if (confirm("Reset the global world? Everyone's builds in it are deleted; the next player to enter starts a fresh map.")) {
      router.delete('/admin/global-world', { preserveScroll: true })
    }
  }
  const hours = loginWindow.enabled
    ? `${loginWindow.start}–${loginWindow.end} on ${loginWindow.days.map(d => DAY_NAMES[d]).join(', ') || 'no days'} (${loginWindow.timezone})`
    : 'no limit — players can sign in any time'

  return (
    <AdminLayout title="Overview" refresh={['counts', 'windowOpen', 'globalWorld']}>
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
          <h2 id="global-heading">Global world</h2>
          <p>
            {globalWorld.save
              ? `Night ${globalWorld.save.night} · ${formatTime(globalWorld.save.seconds)} survived · ${globalWorld.save.players} player${globalWorld.save.players === 1 ? '' : 's'} have played · saved ${timeAgo(globalWorld.save.updated_at)} · ${Math.round(globalWorld.save.size / 1024)} KB.`
              : 'Nobody has played the global world yet.'}
            {' '}
            {globalWorld.online > 0
              ? `${globalWorld.online} online now, hosted by ${globalWorld.host_name ?? 'someone'}.`
              : 'Nobody is in it right now.'}
          </p>
        </header>
        {globalWorld.save && (
          <button className="danger" onClick={resetGlobal} disabled={globalWorld.online > 0}>
            {globalWorld.online > 0 ? 'Reset (empty it first)' : 'Reset the global world'}
          </button>
        )}
      </section>
    </AdminLayout>
  )
}
