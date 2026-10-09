'use client'
import * as React from 'react'
import { Input } from './input'
import { useTimezone } from '@/lib/hooks/settings'
import { fromLocalInputValue, toLocalInputValue } from '@/lib/format'

/**
 * A date that may or may not carry a time of day.
 *
 * Tasks and projects need both: "due by noon tomorrow" is a real deadline, and
 * so is "due Friday". The `allDay` flag on the record is what says which, since
 * midnight cannot stand in for "no particular time" without making an actual
 * midnight deadline unexpressible.
 *
 * The form value is always a canonical ISO instant, so the payload helpers stay
 * pure and no caller has to learn about timezones. Only the widget converts:
 *
 *   all-day  the instant is UTC midnight of the calendar day, and the input is
 *            a plain date. Read and written by slicing UTC, exactly as
 *            `calendarDate` and `dayString` already do server-side.
 *   timed    the instant is a real moment, and the input is wall time in the
 *            *pinned* zone — the same conversion the composer uses for
 *            occurredAt, so a deadline never silently means "browser time".
 */

/** The calendar day of an all-day instant. */
export const dayOf = (iso: string) => iso.slice(0, 10)

/** The all-day instant for a calendar day. */
export const isoFromDay = (day: string) =>
  day ? new Date(`${day}T00:00:00.000Z`).toISOString() : ''

/**
 * Timed instant to all-day: keep the calendar day the instant falls on *in the
 * pinned zone*. 5pm on the 24th in Tokyo is still the 24th, even though the
 * same instant is the 23rd in UTC.
 */
export function toAllDay(iso: string, timezone: string): string {
  if (!iso) return ''
  return isoFromDay(toLocalInputValue(iso, timezone).slice(0, 10))
}

/**
 * All-day to timed: keep the day, and place it at `hour` wall time in the
 * pinned zone. Start dates open the working day and due dates close it, which
 * is a better guess than midnight — a deadline defaulting to 00:00 reads as
 * overdue for the whole day it is due.
 */
export function toTimed(iso: string, timezone: string, hour: number): string {
  if (!iso) return ''
  const stamp = `${dayOf(iso)}T${String(hour).padStart(2, '0')}:00`
  return fromLocalInputValue(stamp, timezone)?.toISOString() ?? ''
}

export function DateTimeField({
  value,
  allDay,
  onChange,
}: {
  value: string
  allDay: boolean
  onChange: (iso: string) => void
}) {
  const { timezone } = useTimezone()

  if (allDay) {
    return (
      <Input
        type="date"
        value={value ? dayOf(value) : ''}
        onChange={(e) => onChange(isoFromDay(e.target.value))}
      />
    )
  }

  return (
    <Input
      type="datetime-local"
      value={value ? toLocalInputValue(value, timezone) : ''}
      onChange={(e) => onChange(fromLocalInputValue(e.target.value, timezone)?.toISOString() ?? '')}
    />
  )
}

/**
 * The switch that governs both fields of a record. It is one flag per task or
 * project rather than one per date, because a span with a timed start and an
 * all-day end has no coherent meaning on a calendar.
 */
export function AllDayToggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      All day
    </label>
  )
}
