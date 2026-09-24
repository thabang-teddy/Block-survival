import GameRules from '#support/game_rules'

/** The native client reads the admin's game rules from here before it starts a match. */
export default class GameRulesController {
  async handle() {
    return { rules: (await GameRules.fromSettings()).toJSON() }
  }
}
