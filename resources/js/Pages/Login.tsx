/**
 * The sign-in page — the only thing a guest can see. A successful sign-in or
 * registration redirects to the game page, whose lobby offers Join / Host / Solo.
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
        <p className="account-line">Sign in to play — solo, host a room, or join a friend&apos;s.</p>
        <AccountForm />
      </div>
    </div>
  )
}
