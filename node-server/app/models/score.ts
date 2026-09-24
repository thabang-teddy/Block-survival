import { ScoreSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'

export type LeaderboardRow = {
  name: string
  score: number
}

export default class Score extends ScoreSchema {
  static readonly PER_NIGHT = 100
  static readonly PER_KILL = 5

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  /** the server recomputes the score, so a client can never post an arbitrary number */
  static compute(nights: number, kills: number): number {
    return nights * Score.PER_NIGHT + kills * Score.PER_KILL
  }

  /** top runs, one row per player (their best) */
  static async leaderboard(limit: number): Promise<LeaderboardRow[]> {
    const rows: { name: string | null; best: number }[] = await db
      .from('scores')
      .leftJoin('users', 'users.id', 'scores.user_id')
      .select('users.name as name')
      .max('scores.score as best')
      .groupBy('scores.user_id', 'users.name')
      .orderBy('best', 'desc')
      .limit(limit)
    return rows.map((r) => ({ name: r.name ?? 'Unknown', score: Number(r.best) }))
  }
}
