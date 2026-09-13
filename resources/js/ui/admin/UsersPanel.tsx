/** Every account: promote, disable, delete. The signed-in admin's own row is read-only. */
import { router } from '@inertiajs/react'
import { when, type AdminUser } from './types'

interface Props {
  users: AdminUser[]
  meId: number
}

export function UsersPanel({ users, meId }: Props) {
  const act = (path: string, question?: string) => {
    if (question && !confirm(question)) return
    router.visit(path, { method: path.endsWith('/toggle-admin') || path.endsWith('/toggle-disabled') ? 'post' : 'delete', preserveScroll: true })
  }

  return (
    <section className="admin-panel" aria-labelledby="users-heading">
      <header>
        <h2 id="users-heading">Players <span className="badge">{users.length}</span></h2>
        <p>Disabling an account keeps its saves and scores but signs it out and refuses sign-in. Deleting removes everything.</p>
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>PCs</th><th>Last sign-in</th><th>Joined</th><th /></tr>
          </thead>
          <tbody>
            {users.map(u => {
              const me = u.id === meId
              return (
                <tr key={u.id} className={u.is_disabled ? 'disabled' : ''}>
                  <td><b>{u.name}</b>{me && <small>you</small>}</td>
                  <td className="mono">{u.email}</td>
                  <td>
                    {u.is_admin ? <span className="tag role-admin">admin{u.is_env_admin && ' (.env)'}</span> : <span className="tag">player</span>}
                    {u.is_disabled && <span className="tag off">disabled</span>}
                  </td>
                  <td className="mono">{u.devices_count}</td>
                  <td>{when(u.last_login_at)}</td>
                  <td>{when(u.created_at)}</td>
                  <td className="actions">
                    {!me && !u.is_env_admin && (
                      <button onClick={() => act(`/admin/users/${u.id}/toggle-admin`)}>{u.is_admin ? 'Make player' : 'Make admin'}</button>
                    )}
                    {!me && !u.is_env_admin && (
                      <button onClick={() => act(`/admin/users/${u.id}/toggle-disabled`)}>{u.is_disabled ? 'Enable' : 'Disable'}</button>
                    )}
                    {!me && !u.is_env_admin && (
                      <button className="danger" onClick={() => act(`/admin/users/${u.id}`, `Delete ${u.name} and all their saves and scores?`)}>Delete</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
