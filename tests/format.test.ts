import { describe, expect, it } from 'vitest'
import { formatInstant, isValidTimezone, browserTimezone, zoneOffsetLabel } from '@/lib/format'
import { calendarDate } from '@/lib/utils'

/** The instant the user's own notes were written: 02:46 UTC on Aug 21. */
const INSTANT = '2026-08-21T02:46:00.000Z'

describe('formatInstant', () => {
  it('renders an instant in the requested zone, not the machine zone', () => {
    expect(formatInstant(INSTANT, 'yyyy-MM-dd HH:mm', 'UTC')).toBe('2026-08-21 02:46')
    expect(formatInstant(INSTANT, 'yyyy-MM-dd HH:mm', 'America/Los_Angeles')).toBe(
      '2026-08-20 19:46',
    )
    expect(formatInstant(INSTANT, 'yyyy-MM-dd HH:mm', 'Australia/Sydney')).toBe('2026-08-21 12:46')
  })

  it('can roll the calendar day backwards across the date line', () => {
    // Same moment, three different dates on the wall.
    const days = ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati'].map((tz) =>
      formatInstant(INSTANT, 'dd', tz),
    )
    expect(new Set(days).size).toBeGreaterThan(1)
  })

  it('respects daylight saving for the zone', () => {
    const winter = '2026-01-15T20:00:00.000Z'
    const summer = '2026-07-15T20:00:00.000Z'
    expect(formatInstant(winter, 'HH:mm', 'America/Los_Angeles')).toBe('12:00') // PST, -8
    expect(formatInstant(summer, 'HH:mm', 'America/Los_Angeles')).toBe('13:00') // PDT, -7
  })

  it('returns an empty string for absent or invalid input', () => {
    expect(formatInstant(null, 'HH:mm', 'UTC')).toBe('')
    expect(formatInstant(undefined, 'HH:mm', 'UTC')).toBe('')
    expect(formatInstant('not a date', 'HH:mm', 'UTC')).toBe('')
  })
})

describe('calendar dates stay zone-independent', () => {
  it('does not shift a birthday no matter the display zone', () => {
    // A birthday is a day on a wall calendar, not a moment; applying a timezone
    // to it is what previously rendered the 14th as the 13th.
    const d = calendarDate('1988-06-14T00:00:00.000Z')!
    expect(d.getDate()).toBe(14)
    expect(d.getMonth()).toBe(5)
  })
})

describe('timezone helpers', () => {
  it('accepts real IANA zones and rejects nonsense', () => {
    expect(isValidTimezone('America/Denver')).toBe(true)
    expect(isValidTimezone('UTC')).toBe(true)
    expect(isValidTimezone('Mars/Olympus_Mons')).toBe(false)
  })

  it('always resolves a browser zone', () => {
    expect(browserTimezone().length).toBeGreaterThan(0)
  })

  it('labels the offset for a zone', () => {
    expect(zoneOffsetLabel('UTC', new Date(INSTANT))).toMatch(/UTC|GMT/)
    expect(zoneOffsetLabel('America/Los_Angeles', new Date(INSTANT))).toMatch(/GMT-7|GMT-8/)
  })
})
