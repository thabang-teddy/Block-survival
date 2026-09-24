var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';
import { DeviceSchema } from '#database/schema';
import { belongsTo, scope } from '@adonisjs/lucid/orm';
import adminConfig from '#config/admin';
import User from '#models/user';
import { sqlTime } from '#support/time';
const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export default class Device extends DeviceSchema {
    static TOKEN_LENGTH = 64;
    static TOKEN_PATTERN = /^[A-Za-z0-9]{64}$/;
    static approved = scope((query) => {
        query.whereNotNull('approved_at');
    });
    static pending = scope((query) => {
        query.whereNull('approved_at');
    });
    isApproved() {
        return this.approvedAt != null;
    }
    static newToken() {
        const bytes = randomBytes(Device.TOKEN_LENGTH);
        return Array.from(bytes, (b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join('');
    }
    static async findByToken(token) {
        if (typeof token !== 'string' || !Device.TOKEN_PATTERN.test(token))
            return null;
        return Device.findBy('token', token);
    }
    static async pendingCount() {
        const [row] = await Device.query().withScopes((s) => s.pending()).count('* as n');
        return Number(row.$extras.n);
    }
    static async approvedCount() {
        const [row] = await Device.query().withScopes((s) => s.approved()).count('* as n');
        return Number(row.$extras.n);
    }
    static async pruneStale() {
        const cutoff = DateTime.now().minus({ days: adminConfig.devicePendingDays });
        await Device.query().withScopes((s) => s.pending()).where('created_at', '<', sqlTime(cutoff)).delete();
    }
}
__decorate([
    belongsTo(() => User),
    __metadata("design:type", Object)
], Device.prototype, "user", void 0);
__decorate([
    belongsTo(() => User, { foreignKey: 'approvedBy' }),
    __metadata("design:type", Object)
], Device.prototype, "approver", void 0);
//# sourceMappingURL=device.js.map