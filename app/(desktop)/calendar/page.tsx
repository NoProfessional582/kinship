'use client'
import * as React from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NewEventDialog } from '@/components/calendar/new-event-dialog'
import { Card } from '@/components/ui/misc'
import { TodayPanel, useToday } from '@/components/dashboard/today-panel'
import { useZonedToday } from '@/lib/hooks/settings'
import type { CalendarControls, CalendarViewName } from '@/components/calendar/calendar-view'
import { CATEGORY_META, EVENT_CATEGORIES, type EventCategory } from '@/lib/calendar-categories'
import { format, isSameDay } from 'date-fns'
import { cn } from '@/lib/utils'

const CalendarView = dynamic(
  () => import('@/components/calendar/calendar-view').then((m) => m.CalendarView),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading calendar…
      </div>
    ),
  },
)

/**
 * FullCalendar hands back a "marker" Date whose UTC fields carry the calendar's
 * own date. Formatting it in the browser zone shifts the month label back a day
 * for anyone west of UTC — which is how August rendered as July.
 */
function markerToLocal(d: Date) {
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * The chips above the grid. "Notes & messages" is off to begin with: a note you
 * typed this morning is a record of what happened, not an appointment, and
 * leaving those on is what buried the real dates.
 */
const CATEGORY_CHIPS = EVENT_CATEGORIES.map((key) => ({ key, ...CATEGORY_META[key] }))

const DEFAULT_CATEGORIES: EventCategory[] = EVENT_CATEGORIES.filter((c) => c !== 'log')
const STORE_KEY = 'kb.calendar.categories'

const VIEWS: { value: CalendarViewName; label: string }[] = [
  { value: 'dayGridMonth', label: 'Month' },
  { value: 'timeGridWeek', label: 'Week' },
  { value: 'listWeek', label: 'List' },
]

export default function CalendarPage() {
  const router = useRouter()
  const controls = React.useRef<CalendarControls | null>(null)
  const [view, setView] = React.useState<CalendarViewName>('dayGridMonth')
  const [anchor, setAnchor] = React.useState<Date | null>(null)
  const [active, setActive] = React.useState<Set<EventCategory>>(() => new Set(DEFAULT_CATEGORIES))
  // Null means "today", which is also what the rail falls back to — the day is
  // only pinned once you pick one.
  const [day, setDay] = React.useState<Date | null>(null)
  const [creating, setCreating] = React.useState(false)

  // Read after mount: the server has no localStorage, and seeding state from it
  // during render would mismatch hydration.
  React.useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? 'null')
      if (Array.isArray(saved)) setActive(new Set(saved as EventCategory[]))
    } catch {
      /* private mode, or someone hand-edited it */
    }
  }, [])

  const toggle = (key: EventCategory) => {
    setActive((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify([...next]))
      } catch {
        /* ignore */
      }
      return next
    })
  }
  const { events } = useToday(day)

  // Resolved after mount, and in the app's zone rather than the browser's. The
  // server renders on its own clock, so a date printed during SSR disagrees
  // with the client's and React throws a hydration mismatch before anything is
  // even wrong on screen.
  const today = useZonedToday()

  const shown = day ?? today
  const isToday = !day || (today ? isSameDay(day, today) : true)

  const open = (source: string, id: string) => {
    if (source === 'entry') router.push(`/notes/${id}`)
    else if (source === 'task') router.push(`/board?task=${id}`)
    else if (source === 'project') router.push(`/projects/${id}`)
    else router.push(`/contacts/${id}`)
  }

  const title = anchor
    ? view === 'dayGridMonth'
      ? format(anchor, 'MMMM yyyy')
      : format(anchor, "'Week of' MMMM d")
    : ''

  return (
    <div className="mx-auto max-w-[var(--page-max)] px-6 py-8 lg:px-8">
      {/* Everything above the calendar is placed in the calendar's own column,
          so the toolbar is bounded by the grid it drives rather than by the
          page. Explicit rows put the rail alongside the calendar itself rather
          than at the top of the column, so the two cards start level.
          Row gap is 0 — the vertical rhythm comes from the margins. */}
      <div className="grid items-start gap-x-6 lg:grid-cols-[minmax(0,1fr)_19.5rem]">
        {/* Deliberately not flex-wrap. A wrapping flex line moves the whole
            controls group onto its own row the moment the header runs out of
            width; shrinking the prose instead keeps them on the subtitle's
            line, where the only thing that gives is the hint text. */}
        <header className="mb-6 flex items-end justify-between gap-4 lg:col-start-1 lg:row-start-1">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--primary)]">
              Your time
            </p>
            <h1 className="mt-1 min-h-[1.1em] text-[2.6rem] leading-[1.08]">{title}</h1>
            <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">
              Click a day to read it in the rail; drag anything to reschedule it. New events land on
              the selected day.
            </p>
          </div>

          {/* items-end on the header sits these on the subtitle's line, and
              nothing the filter chips do below can push them off it. */}
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] p-0.5">
              {VIEWS.map((v) => (
                <button
                  key={v.value}
                  onClick={() => setView(v.value)}
                  className={cn(
                    'rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs font-medium transition-colors',
                    view === v.value
                      ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                      : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>

            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> New event
            </Button>

            <div className="flex items-center gap-1">
              <NavButton label="Previous" onClick={() => controls.current?.prev()}>
                <ChevronLeft className="h-4 w-4" />
              </NavButton>
              <button
                onClick={() => {
                  controls.current?.today()
                  setDay(null)
                }}
                className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] px-3.5 py-2 text-xs font-medium transition-colors hover:bg-[var(--muted)]"
              >
                Today
              </button>
              <NavButton label="Next" onClick={() => controls.current?.next()}>
                <ChevronRight className="h-4 w-4" />
              </NavButton>
            </div>
          </div>
        </header>

        <div className="mb-4 flex flex-wrap items-center gap-1.5 lg:col-start-1 lg:row-start-2">
          <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.13em] text-[var(--muted-foreground)]">
            Showing
          </span>
          {CATEGORY_CHIPS.map((c) => {
            const on = active.has(c.key)
            return (
              <button
                key={c.key}
                onClick={() => toggle(c.key)}
                aria-pressed={on}
                data-cat={c.key}
                data-on={on}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                  on
                    ? 'font-medium text-[var(--foreground)]'
                    : 'border-[var(--border)] text-[var(--muted-foreground)] opacity-60 hover:opacity-100',
                )}
                style={
                  on
                    ? {
                        borderColor: `color-mix(in oklch, ${c.tint} 55%, transparent)`,
                        background: `color-mix(in oklch, ${c.tint} 13%, transparent)`,
                      }
                    : undefined
                }
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: on ? c.tint : 'var(--muted-foreground)' }}
                />
                {c.label}
              </button>
            )
          })}
        </div>

        <Card className="kb-cal overflow-hidden p-1.5 lg:col-start-1 lg:row-start-3">
          <div className={view === 'dayGridMonth' ? '' : 'h-[calc(100vh-15rem)] min-h-[34rem]'}>
            <CalendarView
              view={view}
              categories={active}
              controlRef={controls}
              onRangeChange={(start) => setAnchor(markerToLocal(start))}
              onOpen={open}
              selectedDate={day}
              onSelectDay={setDay}
            />
          </div>
        </Card>

        <TodayPanel
          events={events}
          onOpen={open}
          heading={isToday || !shown ? 'Today' : format(shown, 'EEEE')}
          dateLabel={shown ? format(shown, 'MMM d') : undefined}
          onClearDay={isToday ? undefined : () => setDay(null)}
          emptyText={
            isToday || !shown
              ? 'Nothing on the calendar today.'
              : `Nothing on the calendar for ${format(shown, 'MMMM d')}.`
          }
          className="lg:sticky lg:top-8 lg:col-start-2 lg:row-start-3"
        />
      </div>

      {creating && (
        <NewEventDialog
          open={creating}
          onOpenChange={setCreating}
          day={day ?? today}
          onCreated={() => controls.current?.refetch()}
        />
      )}
    </div>
  )
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-[2.1rem] w-[2.1rem] items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
    >
      {children}
    </button>
  )
}
