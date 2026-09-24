/** Every account, with links to edit and a delete. Accounts are only ever created here. */
import { Link, router, usePage } from '@inertiajs/react'
import { AdminLayout } from '../../ui/admin/AdminLayout'
import { when, type AdminUser } from '../../ui/admin/types'
import { formatTime } from '../../game/score'
import type { AdminUsersProps } from '../../net/pageProps'

export default function Users() {
  const { auth, users } = usePage<AdminUsersProps>().props

  const remove = (u: AdminUser) => {
    if (confirm(`Delete ${u.name}, their world and their scores? This cannot be undone.`)) {
      router.delete(`/admin/users/${u.id}`, { preserveScroll: true })
    }
  }

  return (
    <AdminLayout title="Players" refresh={['users']}>
      <section className="admin-panel" aria-labelledby="users-heading">
        <header className="with-action">
          <div>
            <h2 id="users-heading">Players <span className="badge">{users.length}</span></h2>
            <p>There is no sign-up page: every account is created here. Disabling keeps a player&apos;s world but refuses sign-in.</p>
          </div>
          <Link href="/admin/users/create" className="button primary">New player</Link>
        </header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>World</th><th>PCs</th><th>Last sign-in</th><th /></tr>
            </thead>
            <tbody>
              {users.map(u => {
                const me = u.id === auth.user.id
                return (
                  <tr key={u.id} className={u.is_disabled ? 'disabled' : ''}>
                    <td><b>{u.name}</b>{me && <small>you</small>}</td>
                    <td className="mono">{u.email}</td>
                    <td>
                      {u.is_admin ? <span className="tag role-admin">admin{u.is_env_admin && ' (.env)'}</span> : <span className="tag">player</span>}
                      {u.is_disabled && <span className="tag off">disabled</span>}
                    </td>
                    <td>
                      {u.world ? <>night {u.world.night}<small>{formatTime(u.world.seconds)} · saved {when(u.world.updated_at)}</small></> : <i>none yet</i>}
                    </td>
                    <td className="mono">{u.devices_count}</td>
                    <td>{when(u.last_login_at)}</td>
                    <td className="actions">
                      <Link href={`/admin/users/${u.id}/edit`} className="button">Edit</Link>
                      {!me && !u.is_env_admin && <button className="danger" onClick={() => remove(u)}>Delete</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </AdminLayout>
  )
}
