export const DEFAULT_RULES = Object.freeze({
    daySeconds: 900,
    nightSeconds: 300,
    zombiesFirstNight: 8,
    zombiesPerNight: 6,
    spawnDelaySeconds: 2,
    spawnWindow: 0.7,
});
const num = (v, fallback, min, max) => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
export function parseRules(raw) {
    const r = raw ?? {};
    return {
        daySeconds: num(r.daySeconds, DEFAULT_RULES.daySeconds, 30, 7200),
        nightSeconds: num(r.nightSeconds, DEFAULT_RULES.nightSeconds, 30, 7200),
        zombiesFirstNight: num(r.zombiesFirstNight, DEFAULT_RULES.zombiesFirstNight, 0, 200),
        zombiesPerNight: num(r.zombiesPerNight, DEFAULT_RULES.zombiesPerNight, 0, 100),
        spawnDelaySeconds: num(r.spawnDelaySeconds, DEFAULT_RULES.spawnDelaySeconds, 0, 600),
        spawnWindow: num(r.spawnWindowPercent, DEFAULT_RULES.spawnWindow * 100, 5, 100) / 100,
    };
}
export function rulesToWire(rules) {
    return {
        daySeconds: rules.daySeconds,
        nightSeconds: rules.nightSeconds,
        zombiesFirstNight: rules.zombiesFirstNight,
        zombiesPerNight: rules.zombiesPerNight,
        spawnDelaySeconds: rules.spawnDelaySeconds,
        spawnWindowPercent: Math.round(rules.spawnWindow * 100),
    };
}
let current = DEFAULT_RULES;
export const setCurrentRules = (rules) => { current = rules; };
export const currentRules = () => current;
//# sourceMappingURL=rules.js.map