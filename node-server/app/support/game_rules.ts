import Setting from '#models/setting'

export const RULE_DEFAULTS = {
  day_seconds: 900,
  night_seconds: 300,
  zombies_first_night: 8,
  zombies_per_night: 6,
  spawn_delay_seconds: 2,
  spawn_window_percent: 70,
} as const

export type RuleKey = keyof typeof RULE_DEFAULTS
export type RuleValues = Record<RuleKey, number>

/** inclusive bounds per key, shared by the form validation and the parser */
export const RULE_BOUNDS: Readonly<Record<RuleKey, readonly [number, number]>> = {
  day_seconds: [30, 7200],
  night_seconds: [30, 7200],
  zombies_first_night: [0, 200],
  zombies_per_night: [0, 100],
  spawn_delay_seconds: [0, 600],
  spawn_window_percent: [5, 100],
}

export const RULE_KEYS = Object.keys(RULE_DEFAULTS) as RuleKey[]

/** the shape both clients read (camelCase, seconds and counts) */
export type GameRulesJson = {
  daySeconds: number
  nightSeconds: number
  zombiesFirstNight: number
  zombiesPerNight: number
  spawnDelaySeconds: number
  spawnWindowPercent: number
}

const clamp = (key: RuleKey, value: number): number => {
  const [min, max] = RULE_BOUNDS[key]
  return Math.max(min, Math.min(max, value))
}

/**
 * The admin-tunable game clock: how long a day and a night last, and how the night's
 * zombies are scheduled. The web page gets these as a prop, the native client from
 * /api/rules, and the server's rooms play by them.
 */
export default class GameRules {
  constructor(readonly values: Readonly<RuleValues>) {}

  static async fromSettings(): Promise<GameRules> {
    const values = {} as RuleValues
    for (const key of RULE_KEYS) {
      const raw = await Setting.get(`rules.${key}`)
      const n = raw !== null && raw.trim() !== '' ? Number(raw) : Number.NaN
      values[key] = clamp(key, Number.isFinite(n) ? Math.trunc(n) : RULE_DEFAULTS[key])
    }
    return new GameRules(values)
  }

  /** validated form input, keyed like RULE_DEFAULTS */
  static async save(data: Partial<Record<RuleKey, number>>): Promise<void> {
    const settings: Record<string, string> = {}
    for (const key of RULE_KEYS) settings[`rules.${key}`] = String(clamp(key, Math.trunc(data[key] ?? RULE_DEFAULTS[key])))
    await Setting.setMany(settings)
  }

  toJSON(): GameRulesJson {
    const v = this.values
    return {
      daySeconds: v.day_seconds,
      nightSeconds: v.night_seconds,
      zombiesFirstNight: v.zombies_first_night,
      zombiesPerNight: v.zombies_per_night,
      spawnDelaySeconds: v.spawn_delay_seconds,
      spawnWindowPercent: v.spawn_window_percent,
    }
  }
}
