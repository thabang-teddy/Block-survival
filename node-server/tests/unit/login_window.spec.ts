import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import LoginWindow from '#support/login_window'

const TZ = 'Africa/Johannesburg'
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

const window = (start: string, end: string, days: number[] = ALL_DAYS, enabled = true) => new LoginWindow(enabled, start, end, days, TZ)
const at = (local: string) => DateTime.fromFormat(local, 'yyyy-MM-dd HH:mm', { zone: TZ })
const fmt = (dt: DateTime | null) => dt?.toFormat('yyyy-MM-dd HH:mm') ?? null

test.group('LoginWindow', () => {
  test('a disabled window is always open', ({ assert }) => {
    const w = window('09:00', '10:00', [], false)
    assert.isTrue(w.isOpen(at('2026-09-16 03:00')))
    assert.isNull(w.nextOpening(at('2026-09-16 03:00')))
  })

  test('a same-day window is half open and honours the day list', ({ assert }) => {
    const w = window('18:00', '22:00', [1, 2, 3, 4, 5]) // weekday evenings
    assert.isFalse(w.isOpen(at('2026-09-16 17:59')))
    assert.isTrue(w.isOpen(at('2026-09-16 18:00')))
    assert.isTrue(w.isOpen(at('2026-09-16 21:59')))
    assert.isFalse(w.isOpen(at('2026-09-16 22:00')))
    assert.isFalse(w.isOpen(at('2026-09-19 19:00'))) // Saturday
  })

  test('an overnight window belongs to the day it starts on', ({ assert }) => {
    const w = window('22:00', '02:00', [5]) // Friday night only
    assert.isTrue(w.isOpen(at('2026-09-18 23:30'))) // Friday
    assert.isTrue(w.isOpen(at('2026-09-19 01:30'))) // Saturday small hours
    assert.isFalse(w.isOpen(at('2026-09-19 02:00')))
    assert.isFalse(w.isOpen(at('2026-09-19 23:30'))) // Saturday night is not listed
    assert.isFalse(w.isOpen(at('2026-09-18 12:00')))
  })

  test('the check converts to the window timezone', ({ assert }) => {
    const w = window('09:00', '10:00')
    // 07:30 UTC is 09:30 in Johannesburg
    assert.isTrue(w.isOpen(DateTime.fromISO('2026-09-16T07:30:00Z')))
    assert.isFalse(w.isOpen(DateTime.fromISO('2026-09-16T09:30:00Z')))
  })

  test('the next opening is today, later this week or never', ({ assert }) => {
    const w = window('18:00', '22:00', [1, 3]) // Monday and Wednesday
    const monday = at('2026-09-14 10:00')
    assert.equal(fmt(w.nextOpening(monday)), '2026-09-14 18:00')
    assert.include(w.describeNextOpening(monday), 'opens today at 18:00')

    const tuesday = at('2026-09-15 10:00')
    assert.equal(fmt(w.nextOpening(tuesday)), '2026-09-16 18:00')
    assert.include(w.describeNextOpening(tuesday), 'opens Wednesday at 18:00')

    // late on Wednesday, the next one is Monday again
    assert.equal(fmt(w.nextOpening(at('2026-09-16 23:00'))), '2026-09-21 18:00')

    assert.isNull(w.nextOpening(at('2026-09-14 19:00'))) // open now
    const never = window('18:00', '22:00', [])
    assert.isNull(never.nextOpening(monday))
    assert.equal(never.describeNextOpening(monday), 'The server is closed right now.')
  })
})
