import { randomBytes } from 'node:crypto';
export const TICKET_SECONDS = 30;
export class TicketBook {
    now;
    tickets = new Map();
    constructor(now = Date.now) {
        this.now = now;
    }
    issue(ticket) {
        this.sweep();
        const id = randomBytes(24).toString('base64url');
        this.tickets.set(id, { ...ticket, expiresAt: this.now() + TICKET_SECONDS * 1000 });
        return id;
    }
    redeem(id) {
        if (!id)
            return null;
        const t = this.tickets.get(id);
        this.tickets.delete(id);
        if (!t || t.expiresAt < this.now())
            return null;
        return { userId: t.userId, code: t.code, deviceId: t.deviceId };
    }
    sweep() {
        const now = this.now();
        for (const [id, t] of this.tickets)
            if (t.expiresAt < now)
                this.tickets.delete(id);
    }
}
//# sourceMappingURL=tickets.js.map