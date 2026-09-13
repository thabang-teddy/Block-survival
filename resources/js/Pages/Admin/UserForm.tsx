/**
 * Create or edit one account. The same form serves both: with `user` null it
 * posts a new player, otherwise it puts changes (a blank password keeps the old
 * one). Editing also offers a world reset.
 */
import { Link, router, useForm, usePage } from '@inertiajs/react'
import { AdminLayout } from '../../ui/admin/AdminLayout'
import { when } from '../../ui/admin/types'
import { formatTime } from '../../game/score'
import type { AdminUserFormProps } from '../../net/pageProps'

interface Fields {
  name: string
  email: string
  password: string
  is_admin: boolean
  is_disabled: boolean
}

export default function UserForm() {
  const { user } = usePage<AdminUserFormProps>().props

  // keyed so a jump straight from one player's edit page to another's starts a fresh form
  return <UserFormBody key={user?.id ?? 'new'} />
}

function UserFormBody() {
  const { auth, user } = usePage<AdminUserFormProps>().props
  const editing = user !== null
  const me = user?.id === auth.user.id
  // `user` carries the server's whole-account refusals (own role, .env admin); Inertia types errors by field
  const form = useForm<Fields>({
    name: user?.name ?? '',
    email: user?.email ?? '',
    password: '',
    is_admin: user?.is_admin ?? false,
    is_disabled: user?.is_disabled ?? false,
  })
  // your own flags and the .env admin's identity are not editable here (the server refuses too)
  const flagsLocked = me || user?.is_env_admin
  const accountError = (form.errors as Record<string, string | undefined>).user
  const submit = () => {
    form.clearErrors()
    if (editing) form.put(`/admin/users/${user.id}`)
    else form.post('/admin/users')
  }
  const resetWorld = () => {
    if (user && confirm(`Reset ${user.name}'s world? They start again on a fresh island.`)) {
      router.delete(`/admin/users/${user.id}/world`, { preserveScroll: true })
    }
  }

  return (
    <AdminLayout title={editing ? `Edit ${user.name}` : 'New player'}>
      <section className="admin-panel narrow" aria-labelledby="user-heading">
        <header>
          <h2 id="user-heading">{editing ? user.name : 'New player'}</h2>
          <p>{editing ? 'Leave the password blank to keep the current one.' : 'Any password works — hand it to the player; they can sign in once their PC is approved.'}</p>
        </header>
        <form className="user-form" onSubmit={e => { e.preventDefault(); submit() }}>
          <label>
            Player name
            <input value={form.data.name} maxLength={16} autoFocus onChange={e => form.setData('name', e.target.value)} />
            {form.errors.name && <span className="error">{form.errors.name}</span>}
          </label>
          <label>
            Email
            <input type="email" value={form.data.email} disabled={user?.is_env_admin} onChange={e => form.setData('email', e.target.value)} />
            {form.errors.email && <span className="error">{form.errors.email}</span>}
            {user?.is_env_admin && <span className="hint">This is ADMIN_EMAIL — change it in .env.</span>}
          </label>
          <label>
            {editing ? 'New password' : 'Password'}
            <input type="text" value={form.data.password} autoComplete="off" placeholder={editing ? 'unchanged' : ''} onChange={e => form.setData('password', e.target.value)} />
            {form.errors.password && <span className="error">{form.errors.password}</span>}
          </label>
          <div className="flags">
            <label className="switch">
              <input type="checkbox" checked={form.data.is_admin} disabled={flagsLocked} onChange={e => form.setData('is_admin', e.target.checked)} />
              <span>Admin — can open this section, bypasses PC approval and operating hours</span>
            </label>
            <label className="switch">
              <input type="checkbox" checked={form.data.is_disabled} disabled={flagsLocked} onChange={e => form.setData('is_disabled', e.target.checked)} />
              <span>Disabled — cannot sign in; world and scores are kept</span>
            </label>
            {me && <span className="hint">You cannot change your own role.</span>}
          </div>
          {accountError && <p className="error">{accountError}</p>}
          <div className="form-actions">
            <button type="submit" className="primary" disabled={form.processing}>{form.processing ? 'Saving…' : editing ? 'Save changes' : 'Create player'}</button>
            <Link href="/admin/users" className="button">Cancel</Link>
          </div>
        </form>
      </section>

      {editing && (
        <section className="admin-panel narrow" aria-labelledby="world-heading">
          <header>
            <h2 id="world-heading">World</h2>
            <p>
              {user.world
                ? `Night ${user.world.night} · ${formatTime(user.world.seconds)} survived · last saved ${when(user.world.updated_at)} · ${Math.round(user.world.size / 1024)} KB.`
                : 'No world saved yet — their first game starts on a fresh island.'}
            </p>
          </header>
          {user.world && <button className="danger" onClick={resetWorld}>Reset world</button>}
        </section>
      )}
    </AdminLayout>
  )
}
