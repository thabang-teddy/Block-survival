import { DateTime } from 'luxon';
import Device from '#models/device';
import Room from '#models/room';
import User from '#models/user';
import World from '#models/world';
import LoginWindow from '#support/login_window';
import rooms from '#game-server/registry';
const count = async (query) => Number((await query.count('* as n'))[0].$extras.n);
export default class DashboardController {
    async handle({ inertia }) {
        await Device.pruneStale();
        const window = await LoginWindow.fromSettings();
        const globalSave = await World.global();
        return inertia.render('Admin/Dashboard', {
            counts: {
                pendingDevices: await Device.pendingCount(),
                approvedDevices: await Device.approvedCount(),
                users: await count(User.query()),
                disabledUsers: await count(User.query().where('is_disabled', true)),
                rooms: await count(Room.query().withScopes((s) => s.live())),
            },
            loginWindow: window.toJSON(),
            windowOpen: window.isOpen(DateTime.now()),
            globalWorld: { save: globalSave?.meta() ?? null, ...rooms.presence() },
        });
    }
}
//# sourceMappingURL=dashboard_controller.js.map