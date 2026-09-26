/** Inertia props shared by HandleInertiaRequests and provided by PlayController. */
import type { PageProps as InertiaPageProps } from '@inertiajs/core'
import type { ApiUser, GlobalPresence, LeaderboardRow, WorldMeta } from './api'
import type { AdminDevice, AdminPcHost, AdminRoom, AdminUser, GameRulesForm, LoginWindowForm } from '../ui/admin/types'
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
  /** the player's own world and the shared global world; null before the first save of each */
  worlds: { own: WorldMeta | null; global: WorldMeta | null }
  /** who is in the shared global world right now */
  presence: GlobalPresence
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
  /** the shared global world: its save (null before the first) and who is in it */
  globalWorld: { save: WorldMeta | null } & GlobalPresence
  /** the PC that hosts the global world (docs/pc-host-research.md), or null before one is created */
  pcHost: AdminPcHost | null
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
