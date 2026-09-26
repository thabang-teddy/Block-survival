/** Inertia props shared by HandleInertiaRequests and provided by PlayController. */
import type { PageProps as InertiaPageProps } from '@inertiajs/core'
import type { ApiUser, GlobalWorldInfo, LeaderboardRow, WorldMeta } from './api'
import type { AdminDevice, AdminHostKey, AdminRoom, AdminUser, GameRulesForm, LoginWindowForm } from '../ui/admin/types'
import type { GameRulesWire as GameRules } from '../game/rules'

export interface SharedProps extends InertiaPageProps {
  auth: { user: ApiUser | null }
  /** `host_token`: a new host PC token, shown to the admin once */
  flash: { status: string | null; host_token?: string | null }
}

/** the game page sits behind `auth`, so the user is never null there */
export interface PlayProps extends SharedProps {
  auth: { user: ApiUser }
  leaderboard: LeaderboardRow[]
  /** the player's own world; null before its first save */
  worlds: { own: WorldMeta | null }
  /** the global worlds, one per host PC, and who is in each */
  globalWorlds: GlobalWorldInfo[]
  /** the admin's day/night clock and zombie schedule */
  rules: GameRules
}

/** the browser is waiting for an admin to approve it (no session yet) */
export interface PendingApprovalProps extends SharedProps {
  device: { id: number; approved: boolean }
}

/** every admin page: the user is always an admin, and the nav shows the pending-PC badge */
export interface AdminProps extends SharedProps {
  auth: { user: ApiUser }
  pendingDevices: number
}

export interface AdminDashboardProps extends AdminProps {
  counts: { pendingDevices: number; approvedDevices: number; users: number; disabledUsers: number; rooms: number }
  loginWindow: LoginWindowForm
  windowOpen: boolean
  /** the enabled global worlds: state, who is in each and its save */
  globalWorlds: GlobalWorldInfo[]
  /** how many host keys exist, enabled or not */
  hostKeys: number
}

export interface AdminHostsProps extends AdminProps {
  hosts: AdminHostKey[]
  /** the newest Windows installer (deferred: undefined until it arrives, null when none is released) */
  hostApp?: HostAppRelease | null
}

/** App\Support\HostAppRelease: a host-app-v* GitHub Release with its MSI */
export interface HostAppRelease {
  version: string
  name: string
  size: number
  published_at: string | null
  url: string
  page: string
}

export interface AdminHoursProps extends AdminProps {
  loginWindow: LoginWindowForm
  timezones: string[]
}

export interface AdminRulesProps extends AdminProps {
  rules: GameRulesForm
  defaults: GameRulesForm
  bounds: Record<keyof GameRulesForm, [number, number]>
}

export interface AdminDevicesProps extends AdminProps {
  devices: AdminDevice[]
}

export interface AdminUsersProps extends AdminProps {
  users: AdminUser[]
}

export interface AdminUserFormProps extends AdminProps {
  /** null when creating */
  user: AdminUser | null
}

export interface AdminRoomsProps extends AdminProps {
  rooms: AdminRoom[]
}
