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
import { BaseCommand, args } from '@adonisjs/core/ace';
export default class MakeAdmin extends BaseCommand {
    static commandName = 'user:make-admin';
    static description = 'Give an existing user admin rights and approve their devices';
    static options = { startApp: true };
    async run() {
        const { default: User } = await import('#models/user');
        const { default: Device } = await import('#models/device');
        const user = await User.findBy('email', this.email);
        if (!user) {
            this.logger.error(`No user with email ${this.email}.`);
            this.exitCode = 1;
            return;
        }
        user.merge({ isAdmin: true, isDisabled: false });
        await user.save();
        await Device.query()
            .where('user_id', user.id)
            .whereNull('approved_at')
            .update({ approved_at: DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss'), approved_by: user.id });
        this.logger.success(`${user.email} is now an admin.`);
    }
}
__decorate([
    args.string({ description: 'the account to promote' }),
    __metadata("design:type", String)
], MakeAdmin.prototype, "email", void 0);
//# sourceMappingURL=make_admin.js.map