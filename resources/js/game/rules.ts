/**
 * The admin-tunable game clock (App\Support\GameRules): day and night lengths
 * and the zombie schedule. The web game gets them as a page prop, the native
 * client from /api/rules, and a host passes its own to joiners in the welcome
 * so a match runs on one set of rules whatever the admin changes meanwhile.
 */
export interface GameRules {
  daySeconds: number
  nightSeconds: number
  /** zombies on night 1 */
  zombiesFirstNight: number
  /** added every night after the first */
  zombiesPerNight: number
  /** seconds after sunset before the first group appears */
  spawnDelaySeconds: number
  /** the groups are spread over this share of the night, 0..1 */
  spawnWindow: number
}

export const DEFAULT_RULES: Readonly<GameRules> = Object.freeze({
  daySeconds: 900,
  nightSeconds: 300,
  zombiesFirstNight: 8,
  zombiesPerNight: 6,
  spawnDelaySeconds: 2,
  spawnWindow: 0.7,
})

/** what the server sends (percent instead of a fraction) */
export interface GameRulesWire {
  daySeconds: number
  nightSeconds: number
  zombiesFirstNight: number
  zombiesPerNight: number
  spawnDelaySeconds: number
  spawnWindowPercent: number
}

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

/** Rules from the server (or a welcome), with anything missing or absurd replaced by the default. */
export function parseRules(raw: Partial<GameRulesWire> | null | undefined): GameRules {
  const r = raw ?? {}
  return {
    daySeconds: num(r.daySeconds, DEFAULT_RULES.daySeconds, 30, 7200),
    nightSeconds: num(r.nightSeconds, DEFAULT_RULES.nightSeconds, 30, 7200),
    zombiesFirstNight: num(r.zombiesFirstNight, DEFAULT_RULES.zombiesFirstNight, 0, 200),
    zombiesPerNight: num(r.zombiesPerNight, DEFAULT_RULES.zombiesPerNight, 0, 100),
    spawnDelaySeconds: num(r.spawnDelaySeconds, DEFAULT_RULES.spawnDelaySeconds, 0, 600),
    spawnWindow: num(r.spawnWindowPercent, DEFAULT_RULES.spawnWindow * 100, 5, 100) / 100,
  }
}

export function rulesToWire(rules: GameRules): GameRulesWire {
  return {
    daySeconds: rules.daySeconds,
    nightSeconds: rules.nightSeconds,
    zombiesFirstNight: rules.zombiesFirstNight,
    zombiesPerNight: rules.zombiesPerNight,
    spawnDelaySeconds: rules.spawnDelaySeconds,
    spawnWindowPercent: Math.round(rules.spawnWindow * 100),
  }
}

/** the rules the page loaded with; the host's welcome overrides them for a joiner */
let current: GameRules = DEFAULT_RULES

export const setCurrentRules = (rules: GameRules): void => { current = rules }
export const currentRules = (): GameRules => current
