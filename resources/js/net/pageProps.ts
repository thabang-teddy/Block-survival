/** Inertia props shared by HandleInertiaRequests and provided by PlayController. */
import type { PageProps as InertiaPageProps } from '@inertiajs/core'
import type { ApiUser, LeaderboardRow, WorldMeta } from './api'
import type { AdminDevice, AdminRoom, AdminUser, LoginWindowForm } from '../ui/admin/types'

export interface SharedProps extends InertiaPageProps {
  auth: { user: ApiUser | null }
  flash: { status: string | null }
}

/** the game page sits behind `auth`, so the user is never null there */
export interface PlayProps extends SharedProps {
  auth: { user: ApiUser }
  leaderboard: LeaderboardRow[]
  /** the player's one world, or null before their first save */
  world: WorldMeta | null
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
}

export interface AdminHoursProps extends AdminProps {
  loginWindow: LoginWindowForm
  timezones: string[]
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
