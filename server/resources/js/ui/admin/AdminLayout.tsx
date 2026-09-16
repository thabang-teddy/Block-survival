/**
 * Chrome shared by every admin page: the bar with section links (the PCs link
 * carries the pending count), the flash status, and a periodic reload so new
 * sign-in requests show up without anyone pressing F5.
 */
import { useEffect, type ReactNode } from 'react'
import { Head, Link, router, usePage } from '@inertiajs/react'
import type { AdminProps } from '../../net/pageProps'
import '../hud.css'
import './admin.css'

const REFRESH_MS = 15_000

const SECTIONS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/devices', label: 'PCs' },
  { href: '/admin/users', label: 'Players' },
  { href: '/admin/hours', label: 'Hours' },
  { href: '/admin/rules', label: 'Rules' },
  { href: '/admin/rooms', label: 'Rooms' },
] as const

interface Props {
  title: string
  /** props to reload periodically (device lists, counts); omit for forms */
  refresh?: string[]
  children: ReactNode
}

export function AdminLayout({ title, refresh, children }: Props) {
  const { auth, flash, pendingDevices } = usePage<AdminProps>().props
  const path = typeof window === 'undefined' ? '' : window.location.pathname

  useEffect(() => {
    if (!refresh?.length) return
    const timer = setInterval(() => router.reload({ only: [...refresh, 'pendingDevices'] }), REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  return (
    <div className="admin">
      <Head title={`${title} · Admin`} />
      <header className="admin-bar">
        <h1>Block Survival <span>admin</span></h1>
        <nav aria-label="Sections">
          {SECTIONS.map(s => {
            const active = s.href === '/admin' ? path === '/admin' : path.startsWith(s.href)
            return (
              <Link key={s.href} href={s.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
                {s.label}
                {s.href === '/admin/devices' && pendingDevices > 0 && <span className="badge">{pendingDevices}</span>}
              </Link>
            )
          })}
        </nav>
        <p className="account-line">
          <b>{auth.user.name}</b> · <a className="link" href="/">back to the game</a> ·{' '}
          <button className="link" onClick={() => router.post('/logout')}>sign out</button>
        </p>
      </header>
      {flash.status && <p className="flash" role="status">{flash.status}</p>}
      <main>{children}</main>
    </div>
  )
}
