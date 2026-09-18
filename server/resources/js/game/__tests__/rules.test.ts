import { describe, expect, test } from 'vitest'
import { DEFAULT_RULES, parseRules, rulesToWire } from '../rules'
import { DayNight } from '../DayNight'
import { zombiesForNight } from '../../entities/zombies'

describe('game rules', () => {
  test('parseRules fills gaps with the defaults and clamps nonsense', () => {
    expect(parseRules(null)).toEqual(DEFAULT_RULES)
    expect(parseRules({ daySeconds: 120, nightSeconds: 60, spawnWindowPercent: 50 })).toMatchObject({
      daySeconds: 120, nightSeconds: 60, spawnWindow: 0.5, zombiesFirstNight: 8,
    })
    expect(parseRules({ daySeconds: 1, nightSeconds: 1e9, zombiesPerNight: -5 })).toMatchObject({
      daySeconds: 30, nightSeconds: 7200, zombiesPerNight: 0,
    })
    expect(parseRules(rulesToWire(DEFAULT_RULES))).toEqual(DEFAULT_RULES)
  })

  test('the clock follows the admin lengths', () => {
    const d = new DayNight({ daySeconds: 120, nightSeconds: 60 })
    expect(d.timerText).toBe('2:00')
    d.update(121)
    expect(d.phase).toBe('night')
    expect(d.night).toBe(1)
    expect(d.timerText).toBe('0:59')
    d.update(60)
    expect(d.phase).toBe('day')
    expect(d.night).toBe(1)
    d.update(180)
    expect(d.night).toBe(2)
    expect(d.phaseAt(180 + 120 + 30)).toBe('night')
  })

  test('the zombie count follows the admin schedule', () => {
    expect(zombiesForNight(1, 3, 2)).toBe(3)
    expect(zombiesForNight(4, 3, 2)).toBe(9)
    expect(zombiesForNight(4, 0, 0)).toBe(0)
    expect(zombiesForNight(2)).toBe(14) // the defaults
  })
})
