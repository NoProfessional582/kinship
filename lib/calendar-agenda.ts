import { zonedDayOf } from '@/lib/format'
import { AGENDA_CATEGORIES, type CalendarEvent } from '@/lib/calendar-categories'

/**
 * Ordering and filtering rules for any agenda-shaped view of the calendar
 * feed. Both GUIs read these — the desktop Today rail and the mobile agenda —
 * because they encode a timezone bug that was found the hard way, and a second
 * copy of that reasoning is exactly what would drift.
 */

export const SOURCE_LABEL: Record<string, string> = {
  task: 'task', entry: 'note', birthday: 'birthday', followup: 'follow-up',
}

const AGENDA = new Set<string>(AGENDA_CATEGORIES)

/** `YYYY-MM-DD` for a local-midnight Date, without a zone round-trip. */
export const dayKeyOf = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Chronological order for a feed that mixes two representations: an all-day
 * event carries a bare "YYYY-MM-DD", a timed one a full instant.
 *
 * Comparing those strings directly is comparing two different clocks. A meeting
 * at 2026-08-24T15:00Z happens on the 25th in Tokyo, but its raw string sorts
 * ahead of an all-day event stored as "2026-08-25" — so east of UTC an all-day
 * item lost to almost every timed item on its own day, and with a four-item cap
 * it could be pushed off the panel entirely no matter how far ahead it was.
 *
 * Compare the day each event actually falls on, let all-day lead the day it
 * belongs to (it has no time to place it within one), then compare the clock.
 */
export const byWhen = (timezone: string) => {
  const dayOf = (e: CalendarEvent) =>
    e.allDay ? e.start.slice(0, 10) : dayKeyOf(zonedDayOf(e.start, timezone))
  return (a: CalendarEvent, b: CalendarEvent) => {
    const day = dayOf(a).localeCompare(dayOf(b))
    if (day !== 0) return day
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
    return a.start.localeCompare(b.start)
  }
}

/**
 * The feed widens its window for date-only columns, so the day views have to
 * narrow it back. Instants were already bounded correctly by the query; all-day
 * events are compared as calendar days, the only comparison a due date admits.
 */
export const withinDays = (events: CalendarEvent[], fromIso: string, toIso: string) =>
  events.filter((e) => {
    if (!e.allDay) return true
    const day = e.start.slice(0, 10)
    return day >= fromIso && day <= toIso
  })

/**
 * The day views never show the filing noise. A note or an email you logged an
 * hour ago is a record of what happened, not something still on your plate —
 * only the calendar can opt back into those, and only deliberately.
 */
export const agendaOnly = (events: CalendarEvent[]) =>
  events.filter((e) => AGENDA.has(e.category))

/** The day an event actually lands on, in the app's zone. */
export const eventDayKey = (e: CalendarEvent, timezone: string) =>
  e.allDay ? e.start.slice(0, 10) : dayKeyOf(zonedDayOf(e.start, timezone))
