/**
 * Score: nights survived × 100 + kills × 5 (spec §6). Best score is kept in
 * localStorage until the Laravel leaderboard arrives in Phase 7.
 */
export const SCORE_PER_NIGHT = 100
export const SCORE_PER_KILL = 5
const BEST_KEY = 'block-survival:best'

export interface ScoreLine {
  name: string
  score: number
  kills: number
  deaths: number
  nightsSurvived: number
  /** seconds since the run started */
  timeAlive: number
}

export const computeScore = (nightsSurvived: number, kills: number): number =>
  nightsSurvived * SCORE_PER_NIGHT + kills * SCORE_PER_KILL

/** number of dawns reached: the night counter minus the one still in progress */
export const nightsSurvived = (night: number, phase: 'day' | 'night'): number =>
  Math.max(0, phase === 'night' ? night - 1 : night)

export function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0
  } catch {
    return 0
  }
}

/** Store `score` if it beats the saved best; returns the new best. */
export function saveBest(score: number): number {
  const best = Math.max(loadBest(), score)
  try {
    localStorage.setItem(BEST_KEY, String(best))
  } catch {
    // private mode / blocked storage: the best is simply not remembered
  }
  return best
}

export const formatTime = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(s % 60).padStart(2, '0')}`
}
