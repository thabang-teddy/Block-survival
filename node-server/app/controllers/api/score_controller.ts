import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import Score from '#models/score'
import type User from '#models/user'

const LEADERBOARD_SIZE = 20

const scoreValidator = vine.create({
  nights: vine.number().withoutDecimals().range([0, 1000]),
  kills: vine.number().withoutDecimals().range([0, 100000]),
  deaths: vine.number().withoutDecimals().range([0, 100000]),
  seconds: vine.number().withoutDecimals().range([0, 604800]),
})

/**
 * Runs posted by a native client hosting peer-to-peer. The web client never posts: the
 * rooms this server runs record every player's runs themselves.
 */
export default class ScoreController {
  /** the score is recomputed from nights and kills, so a client cannot post an arbitrary number */
  async store({ request, response, auth }: HttpContext) {
    const data = await request.validateUsing(scoreValidator)
    const user = auth.user as User
    const score = await Score.create({ ...data, userId: user.id, score: Score.compute(data.nights, data.kills) })
    const [best] = await Score.query().where('user_id', user.id).max('score as best')
    return response.created({ score: score.score, best: Number(best.$extras.best) })
  }

  /** top runs, one row per player (their best) */
  async leaderboard() {
    return { leaderboard: await Score.leaderboard(LEADERBOARD_SIZE) }
  }
}
