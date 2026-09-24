import AccessPolicy from '#services/access_policy';
export default class PendingApprovalController {
    async show(ctx) {
        const device = await AccessPolicy.knownDevice(ctx);
        if (!device)
            return ctx.response.redirect('/login');
        return ctx.inertia.render('PendingApproval', { device: { id: device.id, approved: device.isApproved() } });
    }
    async status(ctx) {
        const device = await AccessPolicy.knownDevice(ctx);
        return { known: device !== null, approved: device?.isApproved() ?? false };
    }
}
//# sourceMappingURL=pending_approval_controller.js.map