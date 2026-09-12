/** Inertia props shared by HandleInertiaRequests and provided by PlayController. */
import type { PageProps as InertiaPageProps } from '@inertiajs/core'
import type { ApiUser, LeaderboardRow, SaveMeta } from './api'

export interface SharedProps extends InertiaPageProps {
  auth: { user: ApiUser | null }
  flash: { status: string | null }
}

export interface PlayProps extends SharedProps {
  leaderboard: LeaderboardRow[]
  cloudSave: SaveMeta | null
}
