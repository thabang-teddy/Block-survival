import vine from '@vinejs/vine';
import User from '#models/user';
import World from '#models/world';
import { failValidation } from '#support/validation';
import { iso } from '#support/time';
import rooms from '#game-server/registry';
const NAME = /^[\p{L}\p{N} _-]+$/u;
const userValidator = (ignoreId) => vine.create({
    name: vine
        .string()
        .minLength(2)
        .maxLength(16)
        .regex(NAME)
        .unique({ table: 'users', column: 'name', filter: (q) => {
            if (ignoreId !== null)
                q.whereNot('id', ignoreId);
        } }),
    email: vine
        .string()
        .email()
        .maxLength(255)
        .unique({ table: 'users', column: 'email', filter: (q) => {
            if (ignoreId !== null)
                q.whereNot('id', ignoreId);
        } }),
    password: ignoreId === null ? vine.string().minLength(1).maxLength(255) : vine.string().maxLength(255).nullable().optional(),
    is_admin: vine.boolean(),
    is_disabled: vine.boolean(),
});
async function row(u) {
    await u.loadCount('devices');
    const world = await World.ownOf(u.id);
    return {
        id: u.id,
        name: u.name,
        email: u.email,
        is_admin: u.hasAdminRights(),
        is_env_admin: u.isEnvAdmin(),
        is_disabled: u.isDisabled,
        devices_count: Number(u.$extras.devices_count ?? 0),
        world: world?.meta() ?? null,
        last_login_at: iso(u.lastLoginAt),
        created_at: iso(u.createdAt),
    };
}
export default class UserController {
    async index({ inertia }) {
        const users = await User.query().orderBy('name');
        return inertia.render('Admin/Users', { users: await Promise.all(users.map(row)) });
    }
    async create({ inertia }) {
        return inertia.render('Admin/UserForm', { user: null });
    }
    async store({ request, response, session }) {
        const data = await request.validateUsing(userValidator(null));
        const user = await User.create({
            name: data.name,
            email: data.email,
            password: data.password,
            isAdmin: data.is_admin,
            isDisabled: data.is_disabled,
        });
        session.flash('status', `${user.name} created.`);
        return response.redirect('/admin/users');
    }
    async edit({ params, inertia }) {
        const user = await User.findOrFail(params.user);
        return inertia.render('Admin/UserForm', { user: await row(user) });
    }
    async update({ params, request, response, session, auth }) {
        const user = await User.findOrFail(params.user);
        const data = await request.validateUsing(userValidator(user.id));
        const flagsChanged = data.is_admin !== user.hasAdminRights() || data.is_disabled !== user.isDisabled;
        if (flagsChanged) {
            notSelf(auth.user, user, 'You cannot change your own admin or disabled status.');
            notEnvAdmin(user, 'That account is the ADMIN_EMAIL admin; its role cannot change here.');
        }
        if (user.isEnvAdmin() && data.email.toLowerCase() !== user.email.toLowerCase()) {
            failValidation('email', 'That address is ADMIN_EMAIL; change it in .env.');
        }
        user.merge({ name: data.name, email: data.email, isAdmin: data.is_admin, isDisabled: data.is_disabled });
        if (data.password)
            user.password = data.password;
        await user.save();
        session.flash('status', `${user.name} saved.`);
        return response.redirect('/admin/users');
    }
    async destroy({ params, response, session, auth }) {
        const user = await User.findOrFail(params.user);
        notSelf(auth.user, user, 'You cannot delete your own account.');
        notEnvAdmin(user, 'That account is the ADMIN_EMAIL admin; remove it from .env first.');
        await rooms.closeOwn(user.id, 'This account was deleted.', { save: false });
        await user.delete();
        session.flash('status', `${user.name} deleted.`);
        return response.redirect('/admin/users');
    }
    async resetWorld({ params, response, session }) {
        const user = await User.findOrFail(params.user);
        await rooms.closeOwn(user.id, 'An admin reset this world.', { save: false });
        await World.query().where('user_id', user.id).delete();
        session.flash('status', `${user.name}'s world was reset.`);
        return response.redirect().back();
    }
}
function notSelf(me, user, message) {
    if (me.id === user.id)
        failValidation('user', message);
}
function notEnvAdmin(user, message) {
    if (user.isEnvAdmin())
        failValidation('user', message);
}
//# sourceMappingURL=user_controller.js.map