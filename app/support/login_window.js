import env from '#start/env';
import Setting from '#models/setting';
const DAYS_IN_WEEK = 7;
const dayOfWeek = (dt) => dt.weekday % DAYS_IN_WEEK;
const minutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map((n) => Number.parseInt(n, 10));
    return h * 60 + m;
};
export default class LoginWindow {
    enabled;
    start;
    end;
    days;
    timezone;
    static KEYS = [
        'login_window_enabled',
        'login_window_start',
        'login_window_end',
        'login_window_days',
        'login_window_timezone',
    ];
    constructor(enabled, start, end, days, timezone) {
        this.enabled = enabled;
        this.start = start;
        this.end = end;
        this.days = days;
        this.timezone = timezone;
    }
    static async fromSettings() {
        const raw = (await Setting.get('login_window_days', '0,1,2,3,4,5,6')) ?? '';
        const days = raw
            .split(',')
            .map((d) => Number.parseInt(d, 10))
            .filter((d) => Number.isInteger(d) && d >= 0 && d < DAYS_IN_WEEK);
        return new LoginWindow((await Setting.get('login_window_enabled', '0')) === '1', (await Setting.get('login_window_start', '00:00')) ?? '00:00', (await Setting.get('login_window_end', '23:59')) ?? '23:59', days, (await Setting.get('login_window_timezone')) || env.get('APP_TIMEZONE') || 'UTC');
    }
    toJSON() {
        return { enabled: this.enabled, start: this.start, end: this.end, days: [...this.days], timezone: this.timezone };
    }
    isOpen(at) {
        if (!this.enabled)
            return true;
        const local = at.setZone(this.timezone);
        const minute = local.hour * 60 + local.minute;
        const [start, end] = [minutes(this.start), minutes(this.end)];
        const today = dayOfWeek(local);
        if (start <= end)
            return this.opensOn(today) && minute >= start && minute < end;
        const yesterday = (today + DAYS_IN_WEEK - 1) % DAYS_IN_WEEK;
        return (this.opensOn(today) && minute >= start) || (this.opensOn(yesterday) && minute < end);
    }
    nextOpening(at) {
        if (this.isOpen(at) || this.days.length === 0)
            return null;
        const local = at.setZone(this.timezone);
        const [hour, minute] = this.start.split(':').map((n) => Number.parseInt(n, 10));
        for (let i = 0; i <= DAYS_IN_WEEK; i++) {
            const candidate = local.startOf('day').plus({ days: i }).set({ hour, minute });
            if (this.opensOn(dayOfWeek(candidate)) && candidate > local)
                return candidate;
        }
        return null;
    }
    describeNextOpening(at) {
        const next = this.nextOpening(at);
        if (!next)
            return 'The server is closed right now.';
        const local = at.setZone(this.timezone);
        const day = next.hasSame(local, 'day') ? 'today' : next.setLocale('en').toFormat('cccc');
        return `The server is closed right now — it opens ${day} at ${next.toFormat('HH:mm')} (${this.timezone}).`;
    }
    opensOn(day) {
        return this.days.includes(day);
    }
}
//# sourceMappingURL=login_window.js.map