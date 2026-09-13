/**
 * The sign-in page — the only thing a guest can see. A successful sign-in
 * redirects to the game page, whose lobby offers Join / Host / Solo. Accounts
 * come from the admin; there is nothing to register.
 */
import { Head } from '@inertiajs/react'
import { AccountForm } from '../ui/AccountForm'
import '../ui/hud.css'

export default function Login() {
  return (
    <div className="menu">
      <Head title="Sign in" />
      <div className="menu-card">
        <h1>Block Survival</h1>
        <p className="tagline">Build by day. Hold the line by night.</p>
        <p className="account-line">Sign in to play — solo, host a room, or join a friend&apos;s. No account yet? Ask the admin for one.</p>
        <AccountForm />
      </div>
    </div>
  )
}
