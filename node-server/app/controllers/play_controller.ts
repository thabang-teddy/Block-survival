import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import Score from '#models/score'
import GameRules from '#support/game_rules'
import rooms from '#game-server/registry'

const LEADERBOARD_SIZE = 8

/** The one page: the game. Menu data (leaderboard, the player's worlds) arrives as props. */
export default class PlayController {
  async handle({ inertia, auth }: HttpContext) {
    const user = auth.user as User
    return inertia.render('Play', {
      leaderboard: await Score.leaderboard(LEADERBOARD_SIZE),
      worlds: await user.worldsMeta(),
      // who is in the shared global world right now
      presence: rooms.presence(),
      // the admin's day/night clock and zombie schedule
      rules: (await GameRules.fromSettings()).toJSON(),
    })
  }
}
