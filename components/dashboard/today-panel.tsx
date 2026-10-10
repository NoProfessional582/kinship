'use client'
import * as React from 'react'
import { useBrowserReady } from '@/lib/hooks/platform'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { addDays, startOfDay } from 'date-fns'
import { zonedDayBounds, zonedDayBoundsFor, zonedToday } from '@/lib/format'
import { ArrowRight, X } from 'lucide-react'
import { Card } from '@/components/ui/misc'
import { api } from '@/lib/hooks/api'
import { useTimezone } from '@/lib/hooks/settings'
import { type CalendarEvent } from '@/lib/calendar-categories'
import { SOURCE_LABEL, dayKeyOf, byWhen, withinDays, agendaOnly } from '@/lib/calendar-agenda'
import { cn } from '@/lib/utils'

/**
 * What a merged day looks like: one query, already ordered by clock time.
 * Defaults to today; the calendar passes the day you clicked so the rail can
 * follow the grid instead of being pinned to the present.
 */
export function useToday(day?: Date | null) {
  const { timezone } = useTimezone()
  const ready = useBrowserReady()
  // A Date is a new object every render, so the effect keys off the calendar
  // day it represents — otherwise picking the same day would refetch forever.
  const dayKey = day ? startOfDay(day).getTime() : null
  // Bounded in the *app's* zone, not the browser's. Those differ whenever a
  // zone is pinned in settings, and asking for the wrong 24 hours is how a day
  // full of events came back empty.
  //
  // Both branches produce a *calendar day marker* — a browser-local midnight
  // carrying the day, which is what the grid hands back and what zonedToday
  // returns — so the bounds are built from its date parts. Re-projecting the
  // marker as if it were an instant is the bug this replaces: local midnight on
  // the 7th is 17:00 on the 6th in a zone behind the browser, so clicking a day
  // fetched the day before it and the rail came back empty. Only zones behind
  // the browser's were affected, which is why a Tokyo-pinned app looked fine.
  const range = React.useMemo(() => {
    if (!ready) return null
    const marker = dayKey === null ? zonedToday(timezone) : new Date(dayKey)
    const { start, end } = zonedDayBoundsFor(
      marker.getFullYear(),
      marker.getMonth(),
      marker.getDate(),
      timezone,
    )
    return { start: start.toISOString(), end: new Date(end.getTime() + 1).toISOString() }
  }, [dayKey, timezone, ready])

  const query = useQuery({
    enabled: !!range,
    queryKey: ['calendar', 'today', range?.start],
    queryFn: () =>
      api.get<CalendarEvent[]>(
        `/api/calendar?start=${encodeURIComponent(range!.start)}&end=${encodeURIComponent(range!.end)}`,
      ),
  })

  const dayIso = React.useMemo(
    () => dayKeyOf(dayKey === null ? zonedToday(timezone) : new Date(dayKey)),
    [dayKey, timezone],
  )

  const events = React.useMemo(
    () => withinDays(agendaOnly(query.data ?? []), dayIso, dayIso).sort(byWhen(timezone)),
    [query.data, dayIso, timezone],
  )
  const counts = React.useMemo(
    () => ({
      comms: events.filter((e) => e.source === 'entry').length,
      tasks: events.filter((e) => e.source === 'task').length,
    }),
    [events],
  )

  return { events, counts, isLoading: !range || query.isLoading }
}

/**
 * What is still ahead of you, past today. Deadlines were the only thing here
 * before, which is why a follow-up you booked for next week showed up nowhere.
 */
export function useUpcoming(days = 45, limit = 4) {
  const { timezone } = useTimezone()
  const ready = useBrowserReady()
  // "Tomorrow" and "45 days out" are calendar-day questions, so the window is
  // cut on the user's calendar, not the browser's.
  const range = React.useMemo(() => {
    if (!ready) return null
    const now = new Date()
    return {
      start: zonedDayBounds(addDays(now, 1), timezone).start.toISOString(),
      end: new Date(zonedDayBounds(addDays(now, days), timezone).end.getTime() + 1).toISOString(),
    }
  }, [days, timezone, ready])

  const query = useQuery({
    enabled: !!range,
    queryKey: ['calendar', 'upcoming', range?.start, range?.end, days],
    queryFn: () =>
      api.get<CalendarEvent[]>(
        `/api/calendar?start=${encodeURIComponent(range!.start)}&end=${encodeURIComponent(range!.end)}`,
      ),
  })

  const window = React.useMemo(() => {
    const now = new Date()
    return {
      from: dayKeyOf(addDays(zonedToday(timezone, now), 1)),
      to: dayKeyOf(addDays(zonedToday(timezone, now), days)),
    }
  }, [timezone, days])

  return React.useMemo(
    () =>
      withinDays(query.data ?? [], window.from, window.to)
        // Milestones have their own home in People in orbit; repeating a birthday
        // here would push out the things you actually owe someone.
        .filter((e) => e.category !== 'log' && e.category !== 'milestone')
        .sort(byWhen(timezone))
        .slice(0, limit),
    [query.data, limit, window, timezone],
  )
}

export function TodayPanel({
  events,
  onOpen,
  className,
  dateLabel,
  heading = 'Today',
  emptyText,
  onClearDay,
  children,
}: {
  events: CalendarEvent[]
  onOpen?: (source: string, entityId: string) => void
  className?: string
  /** Replaces the "Open calendar" link — the calendar page shows the date instead. */
  dateLabel?: string
  /** "Today", or the weekday when the calendar is showing another day. */
  heading?: string
  emptyText?: string
  /** Offered only while a day other than today is selected. */
  onClearDay?: () => void
  children?: React.ReactNode
}) {
  const { fmt } = useTimezone()

  return (
    <Card className={cn('flex flex-col overflow-hidden', className)}>
      <div className="flex items-baseline justify-between gap-2 px-4 pt-3.5 pb-2">
        <h2 className="truncate text-[1.15rem]">{heading}</h2>
        {dateLabel ? (
          onClearDay ? (
            <button
              onClick={onClearDay}
              title="Back to today"
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
            >
              {dateLabel}
              <X className="h-2.5 w-2.5" />
            </button>
          ) : (
            <span className="shrink-0 font-mono text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              {dateLabel}
            </span>
          )
        ) : (
          <Link
            href="/calendar"
            className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--primary)]"
          >
            Open calendar <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>

      <div className="flex flex-col px-4 pb-1">
        {events.length === 0 && (
          <p className="py-4 text-xs text-[var(--muted-foreground)] opacity-80">
            {emptyText ?? 'Nothing on the calendar today.'}
          </p>
        )}
        {events.map((e, i) => {
          const clickable = !!onOpen
          const inner = (
            <>
              <span className="w-[3.9rem] shrink-0 pt-0.5 text-right font-mono text-[11px] uppercase text-[var(--muted-foreground)]">
                {e.allDay ? 'All day' : fmt(e.start, 'h:mm a')}
              </span>
              <span
                className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: e.color }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium leading-snug">{e.title}</span>
                <span className="mt-0.5 block truncate text-[11px] text-[var(--muted-foreground)]">
                  {String((e.meta?.kind as string) ?? SOURCE_LABEL[e.source] ?? e.source)
                    .toLowerCase()
                    .replace('_', ' ')}
                  {e.meta?.project ? ` · ${e.meta.project}` : ''}
                </span>
              </span>
            </>
          )
          const cls = cn(
            'flex w-full items-start gap-2.5 py-2.5 text-left',
            i > 0 && 'border-t border-[var(--border)]',
            clickable && 'transition-opacity hover:opacity-70',
          )
          return clickable ? (
            <button key={e.id} className={cls} onClick={() => onOpen!(e.source, e.entityId)}>
              {inner}
            </button>
          ) : (
            <div key={e.id} className={cls}>
              {inner}
            </div>
          )
        })}
      </div>

      {children}
    </Card>
  )
}

/**
 * An inset block inside a rail card. Two of these inside one card is what stops
 * the rail reading as a stack of identical tiles — the card is the subject, the
 * insets are what it currently has to say.
 */
export function Inset({
  label,
  meta,
  children,
  className,
}: {
  label: string
  meta?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'mx-3 mb-3 rounded-[var(--radius-md)] bg-[var(--muted)] px-3 py-2.5',
        className,
      )}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.13em] text-[var(--primary)]">
          {label}
        </span>
        {meta && (
          <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">{meta}</span>
        )}
      </div>
      {children}
    </div>
  )
}
