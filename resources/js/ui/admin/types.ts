/** Props of the Admin page, as built by App\Http\Controllers\Admin\DashboardController. */

export interface LoginWindowForm {
  enabled: boolean
  start: string
  end: string
  days: number[]
  timezone: string
}

export interface AdminDevice {
  id: number
  label: string | null
  user: { id: number; name: string; email: string } | null
  user_agent: string | null
  ip: string | null
  first_seen_at: string | null
  last_seen_at: string | null
  approved_at: string | null
}

export interface AdminUser {
  id: number
  name: string
  email: string
  is_admin: boolean
  is_env_admin: boolean
  is_disabled: boolean
  devices_count: number
  /** the player's one world, or null before their first save */
  world: { size: number; night: number; seconds: number; updated_at: string } | null
  last_login_at: string | null
  created_at: string | null
}

export interface AdminRoom {
  code: string
  host_name: string
  players: number
  expires_at: string
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** "13 Sep, 21:04" or "—" */
export function when(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** the browser family out of a user-agent string, enough to tell PCs apart */
export function browserName(ua: string | null): string {
  if (!ua) return 'Unknown browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  return os ? `${browser} on ${os}` : browser
}
