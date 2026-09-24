/**
 * The sign-in page — the only thing a guest can see. A successful sign-in
 * redirects to the game page, whose lobby offers Join / Host / Solo. Accounts
 * come from the admin; there is nothing to register. In dev only, a guest button
 * creates a throwaway account on first click and signs in as it from then on.
 */
import { useState } from 'react'
import { Head, router } from '@inertiajs/react'
import { AccountForm } from '../ui/AccountForm'
import '../ui/hud.css'

interface Props {
  /** true only in the local (dev) environment */
  guestLogin: boolean
  /** whether the guest account has already been created */
  guestExists: boolean
}

export default function Login({ guestLogin, guestExists }: Props) {
  const [busy, setBusy] = useState(false)

  const guest = () => {
    setBusy(true)
    router.post('/login/guest', {}, { onFinish: () => setBusy(false) })
  }

  return (
    <div className="menu">
      <Head title="Sign in" />
      <div className="menu-card">
        <h1>Block Survival</h1>
        <p className="tagline">Build by day. Hold the line by night.</p>
        <p className="account-line">Sign in to play — your own world, the global one, or a friend&apos;s. No account yet? Ask the admin for one.</p>
        <AccountForm />
        {guestLogin && (
          <p className="dev-guest">
            <button type="button" className="secondary" onClick={guest} disabled={busy}>
              {busy ? '…' : guestExists ? 'Sign in as guest' : 'Create a guest account and sign in'}
            </button>
            <small>dev only — hidden on staging and production</small>
          </p>
        )}
      </div>
    </div>
  )
}
