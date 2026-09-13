/**
 * The admin section (issue #1): operating hours, PC approval, players and live
 * rooms on one scrolling page. Every action is an Inertia form/visit that comes
 * back with fresh props and a flash status.
 */
import { useEffect } from 'react'
import { Head, router, usePage } from '@inertiajs/react'
import type { AdminProps } from '../net/pageProps'
import { LoginWindowPanel } from '../ui/admin/LoginWindowPanel'
import { DevicesPanel } from '../ui/admin/DevicesPanel'
import { UsersPanel } from '../ui/admin/UsersPanel'
import { RoomsPanel } from '../ui/admin/RoomsPanel'
import '../ui/hud.css'
import '../ui/admin/admin.css'

/** new sign-in requests should show up without a manual reload */
const REFRESH_MS = 15_000

export default function Admin() {
  const { auth, flash, loginWindow, timezones, devices, users, rooms } = usePage<AdminProps>().props

  useEffect(() => {
    const timer = setInterval(() => router.reload({ only: ['devices', 'users', 'rooms'] }), REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="admin">
      <Head title="Admin" />
      <header className="admin-bar">
        <h1>Block Survival <span>admin</span></h1>
        <nav aria-label="Sections">
          <a href="#hours-heading">Hours</a>
          <a href="#devices-heading">PCs</a>
          <a href="#users-heading">Players</a>
          <a href="#rooms-heading">Rooms</a>
        </nav>
        <p className="account-line">
          <b>{auth.user.name}</b> · <a className="link" href="/">back to the game</a> ·{' '}
          <button className="link" onClick={() => router.post('/logout')}>sign out</button>
        </p>
      </header>
      {flash.status && <p className="flash" role="status">{flash.status}</p>}
      <main>
        <DevicesPanel devices={devices} />
        <LoginWindowPanel key={JSON.stringify(loginWindow)} initial={loginWindow} timezones={timezones} />
        <UsersPanel users={users} meId={auth.user.id} />
        <RoomsPanel rooms={rooms} />
      </main>
    </div>
  )
}
