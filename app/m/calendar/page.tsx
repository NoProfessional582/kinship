'use client'
import * as React from 'react'
import { useBrowserReady, subscribeBrowser } from '@/lib/hooks/platform'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  addDays,
  addMonths,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  differenceInCalendarDays,
  isSameMonth,
  format,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MEmpty, MList, MRow, MTile } from '@/components/mobile/bits'
import { MobileTaskSheet } from '@/components/mobile/task-sheet'
import { NewEventDialog } from '@/components/calendar/new-event-dialog'
import { api } from '@/lib/hooks/api'
import { useTimezone, useSettings } from '@/lib/hooks/settings'
import { zonedDayBoundsFor, zonedToday } from '@/lib/format'
import { byWhen, eventDayKey, dayKeyOf } from '@/lib/calendar-agenda'
import {
  CATEGORY_META,
  EVENT_CATEGORIES,
  type CalendarEvent,
  type EventCategory,
} from '@/lib/calendar-categories'
import { cn } from '@/lib/utils'
import { m } from '@/lib/mobile/href'

/** Which of the two shapes the phone was last left on. */
const VIEW_KEY = 'kb.m.calendar.view'
type View = 'week' | 'month'

/**
 * The calendar in two shapes, both of them agendas underneath.
 *
 * A month grid at 412px gives each day about 50 pixels — enough for a dot and
 * nothing you can read — so neither view tries to put event titles in a cell.
 * The week gives seven days a strip for orientation and lists all seven below
 * it; the month gives thirty a grid where a day carries only a dot per event,
 * and lists the one day you tap. Same list either way, and the same filter
 * chips over it; what changes is how far ahead you can see at once.
 *
 * The desktop `calendar-view.tsx` and all of its overlap tuning stay exactly as
 * they are; nothing here touches FullCalendar.
 *
 * Ordering and filtering come from `lib/calendar-agenda`, shared with the
 * desktop Today rail, because that is where the all-day-versus-instant sort is
 * worked out and a second copy would drift from it.
 */
function storedView(): View {
  try {
    const view = localStorage.getItem(VIEW_KEY)
    if (view === 'month') return view
  } catch {
    /* private mode */
  }
  return 'week'
}

export default function MobileCalendar() {
  const router = useRouter()
  const { timezone, fmt } = useTimezone()
  const { calendarWeekStart } = useSettings()
  const ready = useBrowserReady()
  const stored = React.useSyncExternalStore(subscribeBrowser, storedView, () => 'week' as View)
  const [viewChoice, setView] = React.useState<View | null>(null)
  const view = viewChoice ?? stored
  /** Any day inside the period on screen. The period itself is derived. */
  const initialCursor = React.useMemo(
    () => (ready ? zonedToday(timezone) : null),
    [ready, timezone],
  )
  const [cursorChoice, setCursorChoice] = React.useState<{ timezone: string; value: Date } | null>(
    null,
  )
  const cursor = cursorChoice?.timezone === timezone ? cursorChoice.value : initialCursor
  const setCursor = (value: Date) => setCursorChoice({ timezone, value })
  const [selected, setSelected] = React.useState<string | null>(null)
  const [openTask, setOpenTask] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [hidden, setHidden] = React.useState<Set<string>>(new Set(['log']))

  const weekStartsOn = calendarWeekStart === 'monday' ? 1 : 0

  const [sourceZone, setSourceZone] = React.useState(timezone)
  if (sourceZone !== timezone) {
    setSourceZone(timezone)
    setCursorChoice(null)
    setView(null)
  }

  const setViewPersisted = (next: View) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      /* not worth a toast */
    }
  }

  /**
   * The span the grid draws, which is not the span the period covers: a month
   * view starts on the weekday its first row starts on and ends on the weekday
   * its last row ends on, so it reaches into both neighbours. Querying the
   * month alone would leave those leading and trailing cells permanently
   * dotless — days that look empty because nothing was asked for.
   */
  const days = React.useMemo(() => {
    if (!cursor) return []
    const from =
      view === 'week'
        ? startOfWeek(cursor, { weekStartsOn })
        : startOfWeek(startOfMonth(cursor), { weekStartsOn })
    const to = view === 'week' ? addDays(from, 6) : endOfWeek(endOfMonth(cursor), { weekStartsOn })
    const count = differenceInCalendarDays(to, from) + 1
    return Array.from({ length: count }, (_, i) => addDays(from, i))
  }, [cursor, view, weekStartsOn])

  const range = React.useMemo(() => {
    if (!days.length) return null
    const first = days[0]
    const last = days[days.length - 1]
    const a = zonedDayBoundsFor(first.getFullYear(), first.getMonth(), first.getDate(), timezone)
    const b = zonedDayBoundsFor(last.getFullYear(), last.getMonth(), last.getDate(), timezone)
    return { start: a.start.toISOString(), end: b.end.toISOString() }
  }, [days, timezone])

  const { data, isLoading } = useQuery({
    enabled: !!range,
    queryKey: ['calendar', 'agenda', range?.start, range?.end],
    queryFn: () =>
      api.get<CalendarEvent[]>(
        `/api/calendar?start=${encodeURIComponent(range!.start)}&end=${encodeURIComponent(range!.end)}`,
      ),
  })

  const byDay = React.useMemo(() => {
    const out = new Map<string, CalendarEvent[]>()
    for (const e of (data ?? []).filter((e) => !hidden.has(e.category))) {
      const k = eventDayKey(e, timezone)
      if (!out.has(k)) out.set(k, [])
      out.get(k)!.push(e)
    }
    for (const list of out.values()) list.sort(byWhen(timezone))
    return out
  }, [data, timezone, hidden])

  const todayKey = cursor ? dayKeyOf(zonedToday(timezone)) : ''

  // The month always has a day open, or the bottom half of the screen is blank
  // for no reason. Today when today is in view, the first of the month when it
  // is not — never a leading cell from the previous month, which is a day you
  // navigated away from.
  if (view === 'month' && cursor) {
    const inView = days.some((d) => dayKeyOf(d) === selected && isSameMonth(d, cursor))
    if (!inView)
      setSelected(
        isSameMonth(zonedToday(timezone), cursor) ? todayKey : dayKeyOf(startOfMonth(cursor)),
      )
  }

  const toggle = (c: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })

  const step = (delta: number) => {
    if (!cursor) return
    setCursor(view === 'week' ? addDays(cursor, delta * 7) : addMonths(cursor, delta))
  }

  // A task opens in a sheet rather than routing to the board, which is the one
  // place the mobile behaviour differs from the desktop's ?task= deep link:
  // bouncing to another tab to read a task loses your place in the period.
  const open = (e: CalendarEvent) => {
    if (e.source === 'task') setOpenTask(e.entityId)
    else if (e.source === 'entry') router.push(m('/notes/' + e.entityId))
    else if (e.source === 'project') router.push(m('/projects/' + e.entityId))
    else router.push(m('/contacts/' + e.entityId))
  }

  /** True while today is somewhere in the period on screen. */
  const onToday = days.some((d) => dayKeyOf(d) === todayKey)

  const title = !cursor
    ? ' '
    : view === 'week'
      ? `${format(days[0], 'MMM d')} – ${format(days[days.length - 1], 'MMM d')}`
      : format(cursor, 'MMMM yyyy')

  /** The day a new event lands on: the one you are looking at, not row one. */
  const newEventDay =
    view === 'month' && selected
      ? (days.find((d) => dayKeyOf(d) === selected) ?? cursor)
      : (days[0] ?? cursor)

  const listed =
    view === 'month'
      ? days.filter((d) => dayKeyOf(d) === selected)
      : days.filter((d) => (byDay.get(dayKeyOf(d))?.length ?? 0) > 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => step(-1)}
          aria-label={view === 'week' ? 'Previous week' : 'Previous month'}
          className="kb-tap flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--muted-foreground)]"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-sm font-semibold">{title}</p>
        {/* Only while it would do something. Stepping a month at a time makes
            the way back much longer than it was a week at a time — four taps
            to undo four — and this is the one control whose absence is the
            signal that you are already where you started. */}
        {cursor && !onToday && (
          <button
            onClick={() => setCursor(zonedToday(timezone))}
            className="kb-tap-inline shrink-0 rounded-full border border-[var(--border)] px-3 text-[11px] text-[var(--muted-foreground)]"
          >
            Today
          </button>
        )}
        <button
          onClick={() => step(1)}
          aria-label={view === 'week' ? 'Next week' : 'Next month'}
          className="kb-tap flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--muted-foreground)]"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Two segments rather than a select: there are exactly two shapes, and
          which one you are in has to be readable without opening anything. */}
      <div className="flex rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] p-0.5">
        {(['week', 'month'] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setViewPersisted(v)}
            aria-pressed={view === v}
            className={cn(
              'kb-tap flex-1 rounded-[var(--radius-sm)] text-[13px] font-medium capitalize transition-colors',
              view === v
                ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                : 'text-[var(--muted-foreground)]',
            )}
          >
            {v}
          </button>
        ))}
      </div>

      {view === 'week' ? (
        /* The week strip is orientation, not a control surface: seven columns
           of date plus a marker, which is all that fits legibly at 412/7. */
        <MTile className="flex gap-1 px-1.5 py-1.5">
          {days.map((d) => {
            const k = dayKeyOf(d)
            const count = byDay.get(k)?.length ?? 0
            const isToday = k === todayKey
            return (
              <div
                key={k}
                className={cn(
                  'flex flex-1 flex-col items-center gap-0.5 rounded-[var(--radius-sm)] py-1.5',
                  isToday && 'bg-[color-mix(in_oklch,var(--primary)_12%,transparent)]',
                )}
              >
                <span className="font-mono text-[9px] uppercase text-[var(--muted-foreground)]">
                  {format(d, 'EEEEE')}
                </span>
                <span
                  className={cn('text-[13px]', isToday ? 'font-bold text-[var(--primary)]' : '')}
                >
                  {format(d, 'd')}
                </span>
                <span
                  className={cn(
                    'h-1 w-1 rounded-full',
                    count > 0 ? 'bg-[var(--muted-foreground)]' : 'bg-transparent',
                  )}
                />
              </div>
            )
          })}
        </MTile>
      ) : (
        <MTile className="px-1.5 py-1.5">
          <div className="grid grid-cols-7">
            {days.slice(0, 7).map((d) => (
              <span
                key={`h-${dayKeyOf(d)}`}
                className="pb-1 text-center font-mono text-[9px] uppercase text-[var(--muted-foreground)]"
              >
                {format(d, 'EEEEE')}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {days.map((d) => {
              const k = dayKeyOf(d)
              const list = byDay.get(k) ?? []
              const isToday = k === todayKey
              const isSelected = k === selected
              const outside = !isSameMonth(d, cursor ?? d)
              return (
                <button
                  key={k}
                  onClick={() => setSelected(k)}
                  aria-pressed={isSelected}
                  aria-label={`${format(d, 'EEEE, MMMM d')}${list.length ? `, ${list.length} events` : ''}`}
                  className={cn(
                    'kb-tap flex flex-col items-center justify-center gap-1 rounded-[var(--radius-sm)] px-0',
                    /* A day off the edge of the month recedes by weight alone,
                       the way the desktop grid does it — tinting those cells
                       turns two whole rows into what looks like a selection. */
                    outside && 'opacity-35',
                    isSelected &&
                      'bg-[color-mix(in_oklch,var(--primary)_14%,transparent)] [box-shadow:inset_0_0_0_1.5px_var(--primary)]',
                    !isSelected &&
                      isToday &&
                      'bg-[color-mix(in_oklch,var(--primary)_10%,transparent)]',
                  )}
                >
                  <span
                    className={cn(
                      'text-[13px] leading-none',
                      isToday && 'font-bold text-[var(--primary)]',
                    )}
                  >
                    {format(d, 'd')}
                  </span>
                  {/* Up to three dots, then a bare count: four dots at this size
                      is a smudge, and the number is the only honest way to say
                      "more than you can count from here". */}
                  <span className="flex h-1.5 items-center justify-center gap-[2px]">
                    {list.slice(0, 3).map((e) => (
                      <span
                        key={e.id}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: e.color }}
                      />
                    ))}
                    {list.length > 3 && (
                      <span className="font-mono text-[8px] leading-none text-[var(--muted-foreground)]">
                        +{list.length - 3}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </MTile>
      )}

      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
        {EVENT_CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => toggle(c)}
            className={cn(
              'kb-tap-inline shrink-0 gap-1.5 rounded-full border px-3 text-[11px] transition-colors',
              hidden.has(c)
                ? 'border-[var(--border)] text-[var(--muted-foreground)] opacity-60'
                : 'border-[var(--border)]',
            )}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: CATEGORY_META[c as EventCategory].tint }}
            />
            {CATEGORY_META[c as EventCategory].short}
          </button>
        ))}
      </div>

      <Button onClick={() => setCreating(true)} variant="ghost" className="w-full">
        <Plus className="h-4 w-4" /> New event
      </Button>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}

      {!isLoading && view === 'week' && listed.length === 0 && <MEmpty>Nothing this week.</MEmpty>}

      {listed.map((d) => {
        const k = dayKeyOf(d)
        const list = byDay.get(k) ?? []
        return (
          <section key={k}>
            <h2
              className={cn(
                'mb-1.5 font-mono text-[10px] uppercase tracking-[0.13em]',
                k === todayKey ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]',
              )}
            >
              {format(d, 'EEEE, MMM d')}
              {k === todayKey ? ' · today' : ''}
            </h2>
            <MTile>
              {list.length === 0 ? (
                <MEmpty>Nothing on this day.</MEmpty>
              ) : (
                <MList>
                  {list.map((e) => (
                    <MRow
                      key={e.id}
                      onClick={() => open(e)}
                      lead={
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: e.color }}
                          title={CATEGORY_META[e.category].short}
                        />
                      }
                      title={e.title}
                      meta={e.allDay ? 'All day' : fmt(e.start, 'HH:mm')}
                    />
                  ))}
                </MList>
              )}
            </MTile>
          </section>
        )
      })}

      <MobileTaskSheet taskId={openTask} onClose={() => setOpenTask(null)} />
      {creating && <NewEventDialog open={creating} onOpenChange={setCreating} day={newEventDay} />}
    </div>
  )
}
