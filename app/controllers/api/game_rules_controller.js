import GameRules from '#support/game_rules';
export default class GameRulesController {
    async handle() {
        return { rules: (await GameRules.fromSettings()).toJSON() };
    }
}
//# sourceMappingURL=game_rules_controller.js.map