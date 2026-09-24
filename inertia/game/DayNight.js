import { DEFAULT_RULES } from "./rules.js";
export const DAY_SECONDS = DEFAULT_RULES.daySeconds;
export const NIGHT_SECONDS = DEFAULT_RULES.nightSeconds;
export const CYCLE_SECONDS = DAY_SECONDS + NIGHT_SECONDS;
const smoothstep = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};
export class DayNight {
    time = 0;
    phase = 'day';
    justChanged = false;
    daySeconds;
    nightSeconds;
    cycleSeconds;
    constructor(rules = DEFAULT_RULES) {
        this.daySeconds = rules.daySeconds;
        this.nightSeconds = rules.nightSeconds;
        this.cycleSeconds = rules.daySeconds + rules.nightSeconds;
    }
    update(dt) {
        this.time += dt;
        const next = this.phaseAt(this.time);
        this.justChanged = next !== this.phase;
        this.phase = next;
    }
    get night() {
        return this.time < this.daySeconds ? 0 : Math.floor((this.time - this.daySeconds) / this.cycleSeconds) + 1;
    }
    phaseAt(t) {
        return t % this.cycleSeconds < this.daySeconds ? 'day' : 'night';
    }
    get secondsToTransition() {
        const inCycle = this.time % this.cycleSeconds;
        return inCycle < this.daySeconds ? this.daySeconds - inCycle : this.cycleSeconds - inCycle;
    }
    get nightProgress() {
        const inCycle = this.time % this.cycleSeconds;
        return inCycle < this.daySeconds ? 0 : (inCycle - this.daySeconds) / this.nightSeconds;
    }
    get timerText() {
        const s = Math.max(0, Math.ceil(this.secondsToTransition));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    sky() {
        const inCycle = this.time % this.cycleSeconds;
        const angle = inCycle < this.daySeconds
            ? (inCycle / this.daySeconds) * Math.PI
            : Math.PI + ((inCycle - this.daySeconds) / this.nightSeconds) * Math.PI;
        const elevation = Math.sin(angle);
        const day = smoothstep(0.05, 0.3, elevation);
        const night = smoothstep(-0.05, -0.3, elevation);
        const sunset = Math.max(0, 1 - day - night);
        const sunX = Math.cos(angle);
        const sunY = elevation;
        const sunZ = 0.35;
        const len = Math.hypot(sunX, sunY, sunZ);
        return { elevation, day, sunset, night, sunX: sunX / len, sunY: sunY / len, sunZ: sunZ / len };
    }
}
//# sourceMappingURL=DayNight.js.map