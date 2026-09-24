import vine from '@vinejs/vine';
import GameRules, { RULE_BOUNDS, RULE_DEFAULTS, RULE_KEYS } from '#support/game_rules';
const rulesValidator = vine.create(Object.fromEntries(RULE_KEYS.map((key) => [key, vine.number().withoutDecimals().range([...RULE_BOUNDS[key]])])));
export default class GameRulesController {
    async show({ inertia }) {
        return inertia.render('Admin/Rules', {
            rules: (await GameRules.fromSettings()).values,
            defaults: RULE_DEFAULTS,
            bounds: Object.fromEntries(RULE_KEYS.map((key) => [key, [...RULE_BOUNDS[key]]])),
        });
    }
    async update({ request, response, session }) {
        await GameRules.save(await request.validateUsing(rulesValidator));
        session.flash('status', 'Game rules saved. They apply to matches started from now on.');
        return response.redirect().back();
    }
}
//# sourceMappingURL=game_rules_controller.js.map