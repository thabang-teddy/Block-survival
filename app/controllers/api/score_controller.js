import vine from '@vinejs/vine';
import Score from '#models/score';
const LEADERBOARD_SIZE = 20;
const scoreValidator = vine.create({
    nights: vine.number().withoutDecimals().range([0, 1000]),
    kills: vine.number().withoutDecimals().range([0, 100000]),
    deaths: vine.number().withoutDecimals().range([0, 100000]),
    seconds: vine.number().withoutDecimals().range([0, 604800]),
});
export default class ScoreController {
    async store({ request, response, auth }) {
        const data = await request.validateUsing(scoreValidator);
        const user = auth.user;
        const score = await Score.create({ ...data, userId: user.id, score: Score.compute(data.nights, data.kills) });
        const [best] = await Score.query().where('user_id', user.id).max('score as best');
        return response.created({ score: score.score, best: Number(best.$extras.best) });
    }
    async leaderboard() {
        return { leaderboard: await Score.leaderboard(LEADERBOARD_SIZE) };
    }
}
//# sourceMappingURL=score_controller.js.map