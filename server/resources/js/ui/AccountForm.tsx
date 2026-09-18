/**
 * Sign-in form, posted as an Inertia form; Laravel redirects to the game page
 * on success or back here with the error. There is no registration or password
 * reset: accounts are handed out by the admin, and any password they set works.
 */
import { useForm } from '@inertiajs/react'

export function AccountForm() {
  const form = useForm({ email: '', password: '' })
  const error = form.errors.email ?? form.errors.password

  const submit = () => {
    form.clearErrors()
    form.post('/login', { preserveScroll: true })
  }

  return (
    <form className="account" onSubmit={e => { e.preventDefault(); submit() }}>
      <input type="email" value={form.data.email} placeholder="Email" autoComplete="email" autoFocus onChange={e => form.setData('email', e.target.value)} />
      <input type="password" value={form.data.password} placeholder="Password" autoComplete="current-password" onChange={e => form.setData('password', e.target.value)} />
      <button type="submit" className="primary" disabled={form.processing || !form.data.email || !form.data.password}>
        {form.processing ? '…' : 'Sign in'}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
