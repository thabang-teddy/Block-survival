import Setting from '#models/setting';
export const RULE_DEFAULTS = {
    day_seconds: 900,
    night_seconds: 300,
    zombies_first_night: 8,
    zombies_per_night: 6,
    spawn_delay_seconds: 2,
    spawn_window_percent: 70,
};
export const RULE_BOUNDS = {
    day_seconds: [30, 7200],
    night_seconds: [30, 7200],
    zombies_first_night: [0, 200],
    zombies_per_night: [0, 100],
    spawn_delay_seconds: [0, 600],
    spawn_window_percent: [5, 100],
};
export const RULE_KEYS = Object.keys(RULE_DEFAULTS);
const clamp = (key, value) => {
    const [min, max] = RULE_BOUNDS[key];
    return Math.max(min, Math.min(max, value));
};
export default class GameRules {
    values;
    constructor(values) {
        this.values = values;
    }
    static async fromSettings() {
        const values = {};
        for (const key of RULE_KEYS) {
            const raw = await Setting.get(`rules.${key}`);
            const n = raw !== null && raw.trim() !== '' ? Number(raw) : Number.NaN;
            values[key] = clamp(key, Number.isFinite(n) ? Math.trunc(n) : RULE_DEFAULTS[key]);
        }
        return new GameRules(values);
    }
    static async save(data) {
        const settings = {};
        for (const key of RULE_KEYS)
            settings[`rules.${key}`] = String(clamp(key, Math.trunc(data[key] ?? RULE_DEFAULTS[key])));
        await Setting.setMany(settings);
    }
    toJSON() {
        const v = this.values;
        return {
            daySeconds: v.day_seconds,
            nightSeconds: v.night_seconds,
            zombiesFirstNight: v.zombies_first_night,
            zombiesPerNight: v.zombies_per_night,
            spawnDelaySeconds: v.spawn_delay_seconds,
            spawnWindowPercent: v.spawn_window_percent,
        };
    }
}
//# sourceMappingURL=game_rules.js.map