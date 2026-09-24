var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { DateTime } from 'luxon';
import { RoomSchema } from '#database/schema';
import { hasMany, scope } from '@adonisjs/lucid/orm';
import RoomInvite from '#models/room_invite';
import { iso, sqlTime } from '#support/time';
export default class Room extends RoomSchema {
    static TTL_HOURS = 2;
    static SERVER_HOST = 'server';
    static live = scope((query) => {
        query.where('expires_at', '>', sqlTime(DateTime.now()));
    });
    static findLive(code) {
        return Room.query().withScopes((s) => s.live()).where('code', code.toUpperCase()).first();
    }
    static freshExpiry() {
        return DateTime.now().plus({ hours: Room.TTL_HOURS });
    }
    isHostedBy(user) {
        return !!user && this.userId !== null && this.userId === user.id;
    }
    isGlobal() {
        return this.worldKind === 'global';
    }
    isServerHosted() {
        return this.hostPeerId === Room.SERVER_HOST;
    }
    async admits(user) {
        if (!user)
            return false;
        if (this.isHostedBy(user) || this.isGlobal())
            return true;
        const invite = await RoomInvite.query()
            .where('room_id', this.id)
            .where('to_user_id', user.id)
            .where('status', RoomInvite.ACCEPTED)
            .first();
        return invite !== null;
    }
    toPublic() {
        return {
            code: this.code,
            host_peer_id: this.hostPeerId,
            host_name: this.hostName,
            world_kind: this.worldKind,
            players: this.players,
            expires_at: iso(this.expiresAt),
        };
    }
}
__decorate([
    hasMany(() => RoomInvite),
    __metadata("design:type", Object)
], Room.prototype, "invites", void 0);
//# sourceMappingURL=room.js.map