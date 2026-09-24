import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import GameRules, { RULE_BOUNDS, RULE_DEFAULTS, RULE_KEYS, type RuleKey } from '#support/game_rules'

const rulesValidator = vine.create(
  Object.fromEntries(
    RULE_KEYS.map((key) => [key, vine.number().withoutDecimals().range([...RULE_BOUNDS[key]])])
  ) as Record<RuleKey, ReturnType<typeof vine.number>>
)

/** Admin page for the day/night clock and the zombie schedule (see app/support/game_rules.ts). */
export default class GameRulesController {
  async show({ inertia }: HttpContext) {
    return inertia.render('Admin/Rules', {
      rules: (await GameRules.fromSettings()).values,
      defaults: RULE_DEFAULTS,
      bounds: Object.fromEntries(RULE_KEYS.map((key) => [key, [...RULE_BOUNDS[key]]])),
    })
  }

  async update({ request, response, session }: HttpContext) {
    await GameRules.save(await request.validateUsing(rulesValidator))
    session.flash('status', 'Game rules saved. They apply to matches started from now on.')
    return response.redirect().back()
  }
}
