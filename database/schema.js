var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { BaseModel, column } from '@adonisjs/lucid/orm';
import { DateTime } from 'luxon';
export class AuthAccessTokenSchema extends BaseModel {
    static $columns = ['abilities', 'createdAt', 'deviceId', 'expiresAt', 'hash', 'id', 'lastUsedAt', 'name', 'tokenableId', 'type', 'updatedAt'];
    $columns = AuthAccessTokenSchema.$columns;
}
__decorate([
    column(),
    __metadata("design:type", String)
], AuthAccessTokenSchema.prototype, "abilities", void 0);
__decorate([
    column.dateTime({ autoCreate: true }),
    __metadata("design:type", DateTime)
], AuthAccessTokenSchema.prototype, "createdAt", void 0);
__decorate([
    column(),
    __metadata("design:type", Object)
], AuthAccessTokenSchema.prototype, "deviceId", void 0);
__decorate([
    column.dateTime(),
    __metadata("design:type", Object)
], AuthAccessTokenSchema.prototype, "expiresAt", void 0);
__decorate([
    column(),
    __metadata("design:type", String)
], AuthAccessTokenSchema.prototype, "hash", void 0);
__decorate([
    column({ isPrimary: true }),
    __metadata("design:type", Number)
], AuthAccessTokenSchema.prototype, "id", void 0);
__decorate([
    column.dateTime(),
    __metadata("design:type", Object)
], AuthAccessTokenSchema.prototype, "lastUsedAt", void 0);
__decorate([
    column(),
    __metadata("design:type", Object)
], AuthAccessTokenSchema.prototype, "name", void 0);
__decorate([
    column(),
    __metadata("design:type", Number)
], AuthAccessTokenSchema.prototype, "tokenableId", void 0);
__decorate([
    column(),
    __metadata("design:type", String)
], AuthAccessTokenSchema.prototype, "type", void 0);
__decorate([
    column.dateTime({ autoCreate: true, autoUpdate: true }),
    __metadata("design:type", DateTime)
], AuthAccessTokenSchema.prototype, "updatedAt", void 0);
export class DeviceSchema extends BaseModel {
    static $columns = ['approvedAt', 'approvedBy', 'createdAt', 'id', 'ip', 'label', 'lastSeenAt', 'token', 'updatedAt', 'userAgent', 'userId'];
    $columns = DeviceSchema.$columns;
}
__decorate([
    column.dateTime(),
    __metadata("design:type", Object)
], DeviceSchema.prototype, "approvedAt", void 0);
__decorate([
    column(),
    __metadata("design:type", Object)
], DeviceSchema.prototype, "approvedBy", void 0);
__decorate([
    column.dateTime({ autoCreate: true }),
    __metadata("design:type", DateTime)
], DeviceSchema.prototype, "createdAt", void 0);
__decorate([
    column({ isPrimary: true }),
    __metadata("design:type", Number)
], DeviceSchema.prototype, "id", void 0);
__decorate([
    column(),
    __metadata("design:type", Object)
], DeviceSchema.prototype, "ip", void 0);
__decorate([
    column(),
    __metadata("design:type", Object)
], DeviceSchema.prototype, "label", void 0);
__decorate([
    column.dateTime(),
    __metadata("design:type", Object)
], DeviceSchema.prototype, "lastSeenAt", void 0);
__decorate([
    column(),
    __metadata("design:type", String)
], DeviceSchema.prototype, "token", void 0);
__decorate([
    column.dateTime({ autoCreate: true, autoUpdate: true }),
    __metadata("design:type", Object)
], DeviceSchema.prototype, "updatedAt", void 0);
__decorate([
    column(),
    __metadata("design:type", Object)
], DeviceSchema.prototype, "userAgent", void 0);
__decorate([
    column(),
    __metadata("design:type", Object)
], DeviceSchema.prototype, "userId", void 0);
export class RoomInviteSchema extends BaseModel {
    static $columns = ['createdAt', 'fromUserId', 'id', 'roomId', 'status', 'toUserId', 'updatedAt'];
    $columns = RoomInviteSchema.$columns;
}
__decorate([
    column.dateTime({ autoCreate: true }),
    __metadata("design:type", DateTime)
], RoomInviteSchema.prototype, "createdAt", void 0);
__decorate([
    column(),
    __metadata("design:type", Number)
], RoomInviteSchema.prototype, "fromUserId", void 0);
__decorate([
    column({ isPrimary: true }),
    __metadata("design:type", Number)
], RoomInviteSchema.prototype, "id", void 0);
__decorate([
    column(),
    __metadata("design:type", Number)
], RoomInviteSchema.prototype, "roomId", void 0);
__decorate([
    column(),
    __metadata("design:type", String)
], RoomInviteSchema.prototype, "status", void 0);
__decorate([
    column(),
    __metadata("design:type", Number)
], RoomInviteSchema.prototype, "toUserId", void 0);
__decorate([
    column.dateTime({ autoCreate: true, autoUpdate: true }),
    __metadata("design:type", Object)
], RoomInviteSchema.prototype, "updatedAt", void 0);
export class RoomSignalSchema extends BaseModel {
    static $columns = ['createdAt', 'data', 'fromPeer', 'id', 'roomCode', 'toPeer', 'type'];
    $columns = RoomSignalSchema.$columns;
}
__decorate([
    column.dateTime({ autoCreate: true }),
    __metadata("design:type", DateTime)
], RoomSignalSchema.prototype, "createdAt", void 0);
__decorate([
    column(),
    __metadata("design:type", String)
], RoomSignalSchema.prototype, "data", void 0);
__decorate([
    column(),
    __metadata("design:type", String)
], RoomSignalSchema.prototype, "fromPeer", void 0);
__decorate([
    column({ isPrimary: true }),
    __metadata("design:type", Number)
], RoomSignalSchema.prototype, "id", void 0);
__decorate([
    column(),
    __metadata("design:type", String)
], RoomSignalSchema.prototype, "roomCode", void 0);
__decorate([
    column(),
    __metadata("design:type", String)
], RoomSignalSchema.prototype, "toPeer", void 0);
__decorate([
    column(),
    __metadata("design:type", String)
], RoomSignalSchema.prototype, "type", void 0);
export class RoomSchema extends BaseModel {
    static $columns = ['code', 'createdAt', 'expiresAt', 'hostName', 'hostPeerId', 'id', 'players', 'updatedAt', 'userId', 'worldKind'];
    $columns = RoomSchema.$columns;
}
__decorate([
    column(),
    __metadata("design:type", String)
], RoomSchema.prototype, "code", void 0);
__decorate([
    column.dateTime({ autoCreate: true }),
    __metadata("design:type", DateTime)
], RoomSchema.prototype, "createdAt", void 0);
__decorate([
    column.dateTime(),
    __metadata("design:type", DateTime)
], RoomSchema.prototype, "expiresAt", void 0);
__decorate([
    column(),
    __metadata("design:type", String)
], RoomSchema.prototype, "hostName", void 0);
__decorate([
    column(),
    __metadata("design:type", String)
], RoomSchema.prototype, "hostPeerId", void 0);
__decorate([
    column({ isPrimary: true }),
    __metadata("design:type", Number)
], RoomSchema.prototype, "id", void 0);
__decorate([
    column(),
    __metadata("design:type", Number)
], RoomSchema.prototype, "players", void 0);
__decorate([
    column.dateTime({ autoCreate: true, autoUpdate: true }),
    __metadata("design:type", Object)
], RoomSchema.prototype, "updatedAt", void 0);
__decorate([
    column(),
    __metadata("design:type", Object)
], RoomSchema.prototype, "userId", void 0);
__decorate([
    column(),
    __metadata("design:type", String)
], RoomSchema.prototype, "worldKind", void 0);
export class SaveSchema extends BaseModel {
    static $columns = ['createdAt', 'id', 'kind', 'night', 'payload', 'players', 'seconds', 'size', 'updatedAt', 'userId'];
    $columns = SaveSchema.$columns;
}
__decorate([
    column.dateTime({ autoCreate: true }),
    __metadata("design:type", DateTime)
], SaveSchema.prototype, "createdAt", void 0);
__decorate([
    column({ isPrimary: true }),
    __metadata("design:type", Number)
], SaveSchema.prototype, "id", void 0);
__decorate([
    column(),
    __metadata("design:type", String)
], SaveSchema.prototype, "kind", void 0);
__decorate([
    column(),
    __metadata("design:type", Number)
], SaveSchema.prototype, "night", void 0);
__decorate([
    column(),
    __metadata("design:type", String)
], SaveSchema.prototype, "payload", void 0);
__decorate([
    column(),
    __metadata("design:type", Number)
], SaveSchema.prototype, "players", void 0);
__decorate([
    column(),
    __metadata("design:type", Number)
], SaveSchema.prototype, "seconds", void 0);
__decorate([
    column(),
    __metadata("design:type", Number)
], SaveSchema.prototype, "size", void 0);
__decorate([
    column.dateTime({ autoCreate: true, autoUpdate: true }),
    __metadata("design:type", Object)
], SaveSchema.prototype, "updatedAt", void 0);
__decorate([
    column(),
    __metadata("design:type", Object)
], SaveSchema.prototype, "userId", void 0);
export class ScoreSchema extends BaseModel {
    static $columns = ['createdAt', 'deaths', 'id', 'kills', 'nights', 'score', 'seconds', 'updatedAt', 'userId'];
    $columns = ScoreSchema.$columns;
}
__decorate([
    column.dateTime({ autoCreate: true }),
    __metadata("design:type", DateTime)
], ScoreSchema.prototype, "createdAt", void 0);
__decorate([
    column(),
    __metadata("design:type", Number)
], ScoreSchema.prototype, "deaths", void 0);
__decorate([
    column({ isPrimary: true }),
    __metadata("design:type", Number)
], ScoreSchema.prototype, "id", void 0);
__decorate([
    column(),
    __metadata("design:type", Number)
], ScoreSchema.prototype, "kills", void 0);
__decorate([
    column(),
    __metadata("design:type", Number)
], ScoreSchema.prototype, "nights", void 0);
__decorate([
    column(),
    __metadata("design:type", Number)
], ScoreSchema.prototype, "score", void 0);
__decorate([
    column(),
    __metadata("design:type", Number)
], ScoreSchema.prototype, "seconds", void 0);
__decorate([
    column.dateTime({ autoCreate: true, autoUpdate: true }),
    __metadata("design:type", Object)
], ScoreSchema.prototype, "updatedAt", void 0);
__decorate([
    column(),
    __metadata("design:type", Number)
], ScoreSchema.prototype, "userId", void 0);
export class SettingSchema extends BaseModel {
    static $columns = ['createdAt', 'key', 'updatedAt', 'value'];
    $columns = SettingSchema.$columns;
}
__decorate([
    column.dateTime({ autoCreate: true }),
    __metadata("design:type", DateTime)
], SettingSchema.prototype, "createdAt", void 0);
__decorate([
    column({ isPrimary: true }),
    __metadata("design:type", String)
], SettingSchema.prototype, "key", void 0);
__decorate([
    column.dateTime({ autoCreate: true, autoUpdate: true }),
    __metadata("design:type", Object)
], SettingSchema.prototype, "updatedAt", void 0);
__decorate([
    column(),
    __metadata("design:type", String)
], SettingSchema.prototype, "value", void 0);
export class UserSchema extends BaseModel {
    static $columns = ['createdAt', 'email', 'id', 'isAdmin', 'isDisabled', 'lastLoginAt', 'name', 'password', 'updatedAt'];
    $columns = UserSchema.$columns;
}
__decorate([
    column.dateTime({ autoCreate: true }),
    __metadata("design:type", DateTime)
], UserSchema.prototype, "createdAt", void 0);
__decorate([
    column(),
    __metadata("design:type", String)
], UserSchema.prototype, "email", void 0);
__decorate([
    column({ isPrimary: true }),
    __metadata("design:type", Number)
], UserSchema.prototype, "id", void 0);
__decorate([
    column(),
    __metadata("design:type", Boolean)
], UserSchema.prototype, "isAdmin", void 0);
__decorate([
    column(),
    __metadata("design:type", Boolean)
], UserSchema.prototype, "isDisabled", void 0);
__decorate([
    column.dateTime(),
    __metadata("design:type", Object)
], UserSchema.prototype, "lastLoginAt", void 0);
__decorate([
    column(),
    __metadata("design:type", String)
], UserSchema.prototype, "name", void 0);
__decorate([
    column({ serializeAs: null }),
    __metadata("design:type", String)
], UserSchema.prototype, "password", void 0);
__decorate([
    column.dateTime({ autoCreate: true, autoUpdate: true }),
    __metadata("design:type", Object)
], UserSchema.prototype, "updatedAt", void 0);
//# sourceMappingURL=schema.js.map