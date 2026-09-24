var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { UserSchema } from '#database/schema';
import hash from '@adonisjs/core/services/hash';
import { compose } from '@adonisjs/core/helpers';
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid';
import { DbAccessTokensProvider } from '@adonisjs/auth/access_tokens';
import { column, hasMany, hasOne } from '@adonisjs/lucid/orm';
import adminConfig from '#config/admin';
import Score from '#models/score';
import World from '#models/world';
import Device from '#models/device';
const AuthFinder = withAuthFinder(() => hash.use(), {
    uids: ['email'],
    passwordColumnName: 'password',
});
export default class User extends compose(UserSchema, AuthFinder) {
    static accessTokens = DbAccessTokensProvider.forModel(User, { table: 'auth_access_tokens' });
    isEnvAdmin() {
        const email = adminConfig.email;
        return email !== '' && email.toLowerCase() === this.email.toLowerCase();
    }
    hasAdminRights() {
        return this.isAdmin || this.isEnvAdmin();
    }
    payload() {
        return { id: this.id, name: this.name, email: this.email, is_admin: this.hasAdminRights() };
    }
    async worldsMeta() {
        const own = await World.query().where('user_id', this.id).where('kind', World.OWN).first();
        const global = await World.global();
        return { own: own?.meta() ?? null, global: global?.meta() ?? null };
    }
}
__decorate([
    column({ consume: (v) => Boolean(v) }),
    __metadata("design:type", Boolean)
], User.prototype, "isAdmin", void 0);
__decorate([
    column({ consume: (v) => Boolean(v) }),
    __metadata("design:type", Boolean)
], User.prototype, "isDisabled", void 0);
__decorate([
    hasMany(() => Score),
    __metadata("design:type", Object)
], User.prototype, "scores", void 0);
__decorate([
    hasOne(() => World, { onQuery: (q) => q.where('kind', World.OWN) }),
    __metadata("design:type", Object)
], User.prototype, "world", void 0);
__decorate([
    hasMany(() => World),
    __metadata("design:type", Object)
], User.prototype, "worlds", void 0);
__decorate([
    hasMany(() => Device),
    __metadata("design:type", Object)
], User.prototype, "devices", void 0);
//# sourceMappingURL=user.js.map