var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { SaveSchema } from '#database/schema';
import { belongsTo, column } from '@adonisjs/lucid/orm';
import User from '#models/user';
import { iso } from '#support/time';
export default class World extends SaveSchema {
    static table = 'saves';
    static MAX_BYTES = 4 * 1024 * 1024;
    static OWN = 'own';
    static GLOBAL = 'global';
    static KINDS = ['own', 'global'];
    static isKind(kind) {
        return World.KINDS.includes(kind);
    }
    static global() {
        return World.query().whereNull('user_id').where('kind', World.GLOBAL).first();
    }
    static ownOf(userId) {
        return World.query().where('user_id', userId).where('kind', World.OWN).first();
    }
    bytes() {
        return Buffer.from(this.payload, 'base64');
    }
    meta() {
        return {
            kind: this.kind,
            size: this.size,
            night: this.night,
            seconds: this.seconds,
            players: this.players ?? 1,
            updated_at: iso(this.updatedAt),
        };
    }
}
__decorate([
    column({ serializeAs: null }),
    __metadata("design:type", String)
], World.prototype, "payload", void 0);
__decorate([
    belongsTo(() => User),
    __metadata("design:type", Object)
], World.prototype, "user", void 0);
//# sourceMappingURL=world.js.map