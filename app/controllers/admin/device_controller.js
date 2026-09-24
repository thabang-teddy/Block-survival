import { DateTime } from 'luxon';
import vine from '@vinejs/vine';
import Device from '#models/device';
import { iso } from '#support/time';
const labelValidator = vine.create({
    label: vine.string().maxLength(40).nullable().optional(),
});
export default class DeviceController {
    async index({ inertia }) {
        await Device.pruneStale();
        const devices = await Device.query().preload('user').orderByRaw('approved_at IS NULL DESC').orderBy('last_seen_at', 'desc');
        return inertia.render('Admin/Devices', {
            devices: devices.map((d) => ({
                id: d.id,
                label: d.label,
                user: d.user ? { id: d.user.id, name: d.user.name, email: d.user.email } : null,
                user_agent: d.userAgent,
                ip: d.ip,
                first_seen_at: iso(d.createdAt),
                last_seen_at: iso(d.lastSeenAt),
                approved_at: iso(d.approvedAt),
            })),
        });
    }
    async approve({ params, response, session, auth }) {
        const device = await Device.findOrFail(params.device);
        device.merge({ approvedAt: DateTime.now(), approvedBy: auth.user.id });
        await device.save();
        session.flash('status', `Device #${device.id} approved.`);
        return response.redirect().back();
    }
    async update({ params, request, response }) {
        const device = await Device.findOrFail(params.device);
        const data = await request.validateUsing(labelValidator);
        device.label = data.label || null;
        await device.save();
        return response.redirect().back();
    }
    async destroy({ params, response, session }) {
        const device = await Device.findOrFail(params.device);
        await device.delete();
        session.flash('status', `Device #${device.id} removed.`);
        return response.redirect().back();
    }
}
//# sourceMappingURL=device_controller.js.map