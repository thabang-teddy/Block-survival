/**
 * The day/night clock: day → sunset → night → dawn. By default 15 min day and
 * 5 min night; the admin can change both (game/rules.ts). The first sunset is
 * when zombies first appear.
 */
import { DEFAULT_RULES, type GameRules } from './rules.ts'

export const DAY_SECONDS = DEFAULT_RULES.daySeconds
export const NIGHT_SECONDS = DEFAULT_RULES.nightSeconds
export const CYCLE_SECONDS = DAY_SECONDS + NIGHT_SECONDS

export type Phase = 'day' | 'night'

export interface SkyState {
  /** -1..1, sin of the sun's elevation (negative at night) */
  elevation: number
  /** 0..1 blend weights for the three palettes */
  day: number
  sunset: number
  night: number
  /** unit sun direction */
  sunX: number
  sunY: number
  sunZ: number
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export class DayNight {
  /** seconds since the game started */
  time = 0
  phase: Phase = 'day'
  /** set for one update after a phase change */
  justChanged = false
  readonly daySeconds: number
  readonly nightSeconds: number
  readonly cycleSeconds: number

  constructor(rules: Pick<GameRules, 'daySeconds' | 'nightSeconds'> = DEFAULT_RULES) {
    this.daySeconds = rules.daySeconds
    this.nightSeconds = rules.nightSeconds
    this.cycleSeconds = rules.daySeconds + rules.nightSeconds
  }

  update(dt: number): void {
    this.time += dt
    const next = this.phaseAt(this.time)
    this.justChanged = next !== this.phase
    this.phase = next
  }

  /** number of sunsets so far: 0 during the first day, 1 on the first night, … */
  get night(): number {
    return this.time < this.daySeconds ? 0 : Math.floor((this.time - this.daySeconds) / this.cycleSeconds) + 1
  }

  phaseAt(t: number): Phase {
    return t % this.cycleSeconds < this.daySeconds ? 'day' : 'night'
  }

  /** seconds until the next sunset / dawn */
  get secondsToTransition(): number {
    const inCycle = this.time % this.cycleSeconds
    return inCycle < this.daySeconds ? this.daySeconds - inCycle : this.cycleSeconds - inCycle
  }

  /** 0..1 progress through the current night (0 during the day) */
  get nightProgress(): number {
    const inCycle = this.time % this.cycleSeconds
    return inCycle < this.daySeconds ? 0 : (inCycle - this.daySeconds) / this.nightSeconds
  }

  get timerText(): string {
    const s = Math.max(0, Math.ceil(this.secondsToTransition))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  sky(): SkyState {
    // the sun arcs 0..π over the day and π..2π over the (shorter) night, so
    // the sun angle tracks the phase rather than the raw cycle fraction
    const inCycle = this.time % this.cycleSeconds
    const angle = inCycle < this.daySeconds
      ? (inCycle / this.daySeconds) * Math.PI
      : Math.PI + ((inCycle - this.daySeconds) / this.nightSeconds) * Math.PI // 0 dawn, π/2 noon, π sunset, 3π/2 midnight
    const elevation = Math.sin(angle)
    const day = smoothstep(0.05, 0.3, elevation)
    const night = smoothstep(-0.05, -0.3, elevation)
    const sunset = Math.max(0, 1 - day - night)
    // the sun rises in +X and sets in -X, arcing over +Z
    const sunX = Math.cos(angle)
    const sunY = elevation
    const sunZ = 0.35
    const len = Math.hypot(sunX, sunY, sunZ)
    return { elevation, day, sunset, night, sunX: sunX / len, sunY: sunY / len, sunZ: sunZ / len }
  }
}
