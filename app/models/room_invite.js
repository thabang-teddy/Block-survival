var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { RoomInviteSchema } from '#database/schema';
import { belongsTo, scope } from '@adonisjs/lucid/orm';
import Room from '#models/room';
import User from '#models/user';
import { MAX_PLAYERS } from '#game/net/limits';
import { iso } from '#support/time';
export default class RoomInvite extends RoomInviteSchema {
    static PENDING = 'pending';
    static ACCEPTED = 'accepted';
    static DECLINED = 'declined';
    static pending = scope((query) => {
        query.where('status', RoomInvite.PENDING);
    });
    toPublic() {
        const room = this.room;
        return {
            id: this.id,
            code: room.code,
            host_name: room.hostName,
            world_kind: room.worldKind,
            players: room.players,
            max_players: MAX_PLAYERS,
            expires_at: iso(room.expiresAt),
            status: this.status,
        };
    }
}
__decorate([
    belongsTo(() => Room),
    __metadata("design:type", Object)
], RoomInvite.prototype, "room", void 0);
__decorate([
    belongsTo(() => User, { foreignKey: 'fromUserId' }),
    __metadata("design:type", Object)
], RoomInvite.prototype, "from", void 0);
__decorate([
    belongsTo(() => User, { foreignKey: 'toUserId' }),
    __metadata("design:type", Object)
], RoomInvite.prototype, "to", void 0);
//# sourceMappingURL=room_invite.js.map