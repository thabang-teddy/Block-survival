var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { ScoreSchema } from '#database/schema';
import { belongsTo } from '@adonisjs/lucid/orm';
import User from '#models/user';
import db from '@adonisjs/lucid/services/db';
export default class Score extends ScoreSchema {
    static PER_NIGHT = 100;
    static PER_KILL = 5;
    static compute(nights, kills) {
        return nights * Score.PER_NIGHT + kills * Score.PER_KILL;
    }
    static async leaderboard(limit) {
        const rows = await db
            .from('scores')
            .leftJoin('users', 'users.id', 'scores.user_id')
            .select('users.name as name')
            .max('scores.score as best')
            .groupBy('scores.user_id', 'users.name')
            .orderBy('best', 'desc')
            .limit(limit);
        return rows.map((r) => ({ name: r.name ?? 'Unknown', score: Number(r.best) }));
    }
}
__decorate([
    belongsTo(() => User),
    __metadata("design:type", Object)
], Score.prototype, "user", void 0);
//# sourceMappingURL=score.js.map