import Score from '#models/score';
import GameRules from '#support/game_rules';
import rooms from '#game-server/registry';
const LEADERBOARD_SIZE = 8;
export default class PlayController {
    async handle({ inertia, auth }) {
        const user = auth.user;
        return inertia.render('Play', {
            leaderboard: await Score.leaderboard(LEADERBOARD_SIZE),
            worlds: await user.worldsMeta(),
            presence: rooms.presence(),
            rules: (await GameRules.fromSettings()).toJSON(),
        });
    }
}
//# sourceMappingURL=play_controller.js.map