/**
 * Sign in / register form. Posts to the session routes as Inertia forms; Laravel
 * redirects to the game page on success or back here with validation errors.
 */
import { useState } from 'react'
import { useForm } from '@inertiajs/react'

export function AccountForm() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const form = useForm({ name: '', email: '', password: '' })
  const error = form.errors.email ?? form.errors.password ?? form.errors.name

  const submit = () => {
    form.clearErrors()
    form.post(mode === 'login' ? '/login' : '/register', { preserveScroll: true })
  }

  return (
    <form className="account" onSubmit={e => { e.preventDefault(); submit() }}>
      <div className="tabs">
        <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Sign in</button>
        <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Register</button>
      </div>
      {mode === 'register' && (
        <input value={form.data.name} maxLength={16} placeholder="Player name" autoComplete="username" onChange={e => form.setData('name', e.target.value)} />
      )}
      <input type="email" value={form.data.email} placeholder="Email" autoComplete="email" autoFocus onChange={e => form.setData('email', e.target.value)} />
      <input type="password" value={form.data.password} placeholder="Password (8+)" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} onChange={e => form.setData('password', e.target.value)} />
      <button type="submit" className="primary" disabled={form.processing || !form.data.email || form.data.password.length < 8}>
        {form.processing ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
