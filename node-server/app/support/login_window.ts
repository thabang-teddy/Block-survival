import { DateTime } from 'luxon'
import env from '#start/env'
import Setting from '#models/setting'

const DAYS_IN_WEEK = 7

export type LoginWindowJson = {
  enabled: boolean
  start: string
  end: string
  days: number[]
  timezone: string
}

/** Luxon weekdays are 1 = Monday … 7 = Sunday; the window's are 0 = Sunday … 6 = Saturday */
const dayOfWeek = (dt: DateTime): number => dt.weekday % DAYS_IN_WEEK

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map((n) => Number.parseInt(n, 10))
  return h * 60 + m
}

/**
 * The hours during which players may be signed in ("operating time"). A window belongs
 * to the weekday it starts on, so 22:00–02:00 on Friday runs into Saturday morning.
 * Admins are exempt (see AccessPolicy).
 */
export default class LoginWindow {
  static readonly KEYS = [
    'login_window_enabled',
    'login_window_start',
    'login_window_end',
    'login_window_days',
    'login_window_timezone',
  ] as const

  constructor(
    readonly enabled: boolean,
    readonly start: string,
    readonly end: string,
    /** weekdays the window opens on, 0 = Sunday … 6 = Saturday */
    readonly days: readonly number[],
    readonly timezone: string
  ) {}

  static async fromSettings(): Promise<LoginWindow> {
    const raw = (await Setting.get('login_window_days', '0,1,2,3,4,5,6')) ?? ''
    const days = raw
      .split(',')
      .map((d) => Number.parseInt(d, 10))
      .filter((d) => Number.isInteger(d) && d >= 0 && d < DAYS_IN_WEEK)
    return new LoginWindow(
      (await Setting.get('login_window_enabled', '0')) === '1',
      (await Setting.get('login_window_start', '00:00')) ?? '00:00',
      (await Setting.get('login_window_end', '23:59')) ?? '23:59',
      days,
      (await Setting.get('login_window_timezone')) || env.get('APP_TIMEZONE') || 'UTC'
    )
  }

  toJSON(): LoginWindowJson {
    return { enabled: this.enabled, start: this.start, end: this.end, days: [...this.days], timezone: this.timezone }
  }

  isOpen(at: DateTime): boolean {
    if (!this.enabled) return true
    const local = at.setZone(this.timezone)
    const minute = local.hour * 60 + local.minute
    const [start, end] = [minutes(this.start), minutes(this.end)]
    const today = dayOfWeek(local)

    if (start <= end) return this.opensOn(today) && minute >= start && minute < end

    // overnight: tonight's window, or the tail of yesterday's
    const yesterday = (today + DAYS_IN_WEEK - 1) % DAYS_IN_WEEK
    return (this.opensOn(today) && minute >= start) || (this.opensOn(yesterday) && minute < end)
  }

  /** when the window next opens, or null if it is open now / never opens */
  nextOpening(at: DateTime): DateTime | null {
    if (this.isOpen(at) || this.days.length === 0) return null
    const local = at.setZone(this.timezone)
    const [hour, minute] = this.start.split(':').map((n) => Number.parseInt(n, 10))
    for (let i = 0; i <= DAYS_IN_WEEK; i++) {
      const candidate = local.startOf('day').plus({ days: i }).set({ hour, minute })
      if (this.opensOn(dayOfWeek(candidate)) && candidate > local) return candidate
    }
    return null
  }

  /** "today 18:00" / "Wednesday 18:00", for the sign-in error */
  describeNextOpening(at: DateTime): string {
    const next = this.nextOpening(at)
    if (!next) return 'The server is closed right now.'
    const local = at.setZone(this.timezone)
    const day = next.hasSame(local, 'day') ? 'today' : next.setLocale('en').toFormat('cccc')
    return `The server is closed right now — it opens ${day} at ${next.toFormat('HH:mm')} (${this.timezone}).`
  }

  private opensOn(day: number): boolean {
    return this.days.includes(day)
  }
}
