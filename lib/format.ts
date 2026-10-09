import { TZDate } from '@date-fns/tz'
import { format as fnsFormat } from 'date-fns'

/**
 * Two kinds of date live in this app, and they must be formatted differently.
 *
 * **Instants** — when something happened: `occurredAt`, `createdAt`,
 * `lastContactAt`, `completedAt`. Stored as UTC timestamps. These describe a
 * moment on the world clock, so they must be rendered *in a timezone*; the same
 * instant is 2:46am in UTC and 7:46pm the previous day in Los Angeles.
 *
 * **Calendar dates** — a day on a wall calendar: birthdays, position start/end,
 * milestones, due dates. A birthday on the 14th is the 14th everywhere; it has
 * no time and no zone. Shifting these by a timezone is exactly what produced
 * the off-by-one that showed a June 14th birthday as the 13th, so they are
 * deliberately *not* zone-converted — see `calendarDate` in ./utils.
 */

/** The zone to use when none has been pinned: whatever this browser reports. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** All IANA zones this runtime knows about, for the picker. */
export function allTimezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return ['UTC']
  }
}

/** Formats an instant in the given zone using date-fns tokens. */
export function formatInstant(
  value: string | Date | null | undefined,
  pattern: string,
  timezone: string,
): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return fnsFormat(new TZDate(date, timezone), pattern)
}

/** Short offset label for a zone, e.g. "GMT-7" — used in the settings picker. */
export function zoneOffsetLabel(timezone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    }).formatToParts(at)
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

/** Start/end of the given day *in a zone*, as UTC instants for querying. */
export function zonedDayBoundsFor(
  year: number,
  month: number,
  day: number,
  timezone: string,
): { start: Date; end: Date } {
  const start = new TZDate(year, month, day, 0, 0, 0, 0, timezone)
  const end = new TZDate(year, month, day, 23, 59, 59, 999, timezone)
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) }
}

export function zonedDayBounds(day: Date, timezone: string): { start: Date; end: Date } {
  const z = new TZDate(day, timezone)
  const start = new TZDate(z.getFullYear(), z.getMonth(), z.getDate(), 0, 0, 0, 0, timezone)
  const end = new TZDate(z.getFullYear(), z.getMonth(), z.getDate(), 23, 59, 59, 999, timezone)
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) }
}

/**
 * The calendar day it is *right now* in a zone, as a local-midnight `Date`.
 *
 * Deliberately the same shape `calendarDate` returns, so the two are directly
 * comparable: `differenceInCalendarDays(dueDate, zonedToday(tz))` is the only
 * honest way to ask "is this overdue". Comparing a due date against a raw
 * `new Date()` asks the question in the *browser's* zone instead, which is a
 * different day for several hours out of every 24.
 */
export function zonedToday(timezone: string, at: Date = new Date()): Date {
  const z = new TZDate(at, timezone)
  return new Date(z.getFullYear(), z.getMonth(), z.getDate())
}

/**
 * Milliseconds until the next midnight *in the given zone*.
 *
 * Not the same as 24h after `zonedToday`: that returns a browser-local midnight
 * carrying the zone's calendar day, so adding a day lands on the browser's next
 * midnight, which is a different instant entirely — and one already in the past
 * whenever the pinned zone runs behind the browser.
 */
export function msUntilZoneMidnight(timezone: string, at: Date = new Date()): number {
  const z = new TZDate(at, timezone)
  const nextMidnight = new TZDate(
    z.getFullYear(),
    z.getMonth(),
    z.getDate() + 1,
    0,
    0,
    0,
    0,
    timezone,
  )
  return nextMidnight.getTime() - at.getTime()
}

/**
 * The calendar day an instant falls on, in the given zone, as a local-midnight
 * date — the shape `zonedToday` returns, so the two can be compared directly.
 * A timed deadline needs this rather than `calendarDate`, which slices UTC and
 * would put 9pm Los Angeles on tomorrow's row.
 */
export function zonedDayOf(value: Date | string, timezone: string): Date {
  const z = new TZDate(new Date(value), timezone)
  return new Date(z.getFullYear(), z.getMonth(), z.getDate())
}

/**
 * A month/day placed in a given year, clamped to the end of the month.
 *
 * `new Date(2027, 1, 29)` does not fail — it rolls forward to March 1, so a
 * Feb 29 birthday silently left February in every non-leap year. Feb 28 is the
 * convention, and clamping is what produces it.
 */
export function monthDayIn(year: number, month: number, day: number): Date {
  const lastOfMonth = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(day, lastOfMonth))
}

/** `monthDayIn` for the UTC calendar the date-only columns are stored on. */
export function monthDayInUTC(year: number, month: number, day: number): Date {
  const lastOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(day, lastOfMonth)))
}

/**
 * The next occurrence of a birthday on or after `today`.
 *
 * Birthdays are stored as UTC calendar dates, so the month and day are read in
 * UTC; the result is a local-midnight date to compare against `zonedToday`.
 * Three copies of this calculation had drifted apart — two of them still roll
 * Feb 29 into March — which is why it lives here now.
 */
export function nextAnniversary(birthday: Date | string, today: Date): Date {
  const b = birthday instanceof Date ? birthday : new Date(birthday)
  const month = b.getUTCMonth()
  const day = b.getUTCDate()
  const thisYear = monthDayIn(today.getFullYear(), month, day)
  return thisYear.getTime() < today.getTime()
    ? monthDayIn(today.getFullYear() + 1, month, day)
    : thisYear
}

/**
 * An instant as the `YYYY-MM-DDTHH:mm` a `datetime-local` input wants, read in
 * the given zone.
 *
 * A `datetime-local` has no zone of its own — it is wall time, and the browser
 * neither knows nor cares which zone that wall belongs to. Both directions have
 * to be converted explicitly or the field silently means "browser time" while
 * every label beside it says otherwise.
 */
export function toLocalInputValue(
  value: Date | string | null | undefined,
  timezone: string,
): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return fnsFormat(new TZDate(date, timezone), "yyyy-MM-dd'T'HH:mm")
}

/** The inverse: wall time in a zone back to the instant it names. */
export function fromLocalInputValue(value: string, timezone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!m) return null
  const [, y, mo, d, hh, mm] = m.map(Number) as unknown as number[]
  const z = new TZDate(y, mo - 1, d, hh, mm, 0, 0, timezone)
  const ms = z.getTime()
  return Number.isNaN(ms) ? null : new Date(ms)
}
