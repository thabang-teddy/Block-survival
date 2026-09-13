/** Inertia props shared by HandleInertiaRequests and provided by PlayController. */
import type { PageProps as InertiaPageProps } from '@inertiajs/core'
import type { ApiUser, LeaderboardRow, SaveMeta } from './api'
import type { AdminData } from '../ui/admin/types'

export interface SharedProps extends InertiaPageProps {
  auth: { user: ApiUser | null }
  flash: { status: string | null }
}

/** the game page sits behind `auth`, so the user is never null there */
export interface PlayProps extends SharedProps {
  auth: { user: ApiUser }
  leaderboard: LeaderboardRow[]
  cloudSave: SaveMeta | null
}

/** the browser is waiting for an admin to approve it (no session yet) */
export interface PendingApprovalProps extends SharedProps {
  device: { id: number; approved: boolean }
}

/** the admin section; the user is always an admin here */
export interface AdminProps extends SharedProps, AdminData {
  auth: { user: ApiUser }
}
