/**
 * Shown after a correct sign-in from a browser no admin has approved yet. There
 * is no session; the browser is known by its device cookie. Polls the status
 * endpoint and goes back to the sign-in page once the device is approved.
 */
import { useEffect, useState } from 'react'
import { Head, Link, usePage } from '@inertiajs/react'
import type { PendingApprovalProps } from '../net/pageProps'
import '../ui/hud.css'

const POLL_MS = 10_000

export default function PendingApproval() {
  const { device } = usePage<PendingApprovalProps>().props
  const [approved, setApproved] = useState(device.approved)

  useEffect(() => {
    if (approved) return
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/pending-approval/status', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
        const data = (await res.json()) as { approved: boolean }
        if (data.approved) setApproved(true)
      } catch {
        // offline for a moment: keep polling
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [approved])

  return (
    <div className="menu">
      <Head title="Waiting for approval" />
      <div className="menu-card">
        <h1>Block Survival</h1>
        <p className="tagline">{approved ? 'This PC is approved.' : 'This PC is waiting for approval.'}</p>
        {approved ? (
          <>
            <p className="account-line">An admin has approved this PC — you can sign in now.</p>
            <Link className="link" href="/login">Sign in</Link>
          </>
        ) : (
          <>
            <p className="account-line">
              Your password was right, but this is the first time this PC has signed in. An admin has to
              approve it before you can play. Ask them to approve <b>device #{device.id}</b> in the admin section.
            </p>
            <p className="fine">This page checks every 10 seconds and will tell you when you are through.</p>
          </>
        )}
      </div>
    </div>
  )
}
