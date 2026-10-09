'use client'
import * as React from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import luxonPlugin from '@fullcalendar/luxon3'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/hooks/api'
import { useHoverTip } from '@/components/ui/tooltip'
import { EventChip } from './event-chip'
import { useSettings, useTimezone } from '@/lib/hooks/settings'
import type { CalendarEvent, EventCategory } from '@/lib/calendar-categories'

export type CalendarViewName = 'dayGridMonth' | 'timeGridWeek' | 'listWeek'

export interface CalendarControls {
  prev(): void
  next(): void
  today(): void
  /** Re-run the feed. FullCalendar owns its event store, so anything that
   *  writes an event from outside the grid has to ask for this — react-query
   *  invalidation reaches the rail and the dashboard, but not in here. */
  refetch(): void
}

/**
 * All FullCalendar packages are pinned to 6.1.21. Core and react publish a 7.x
 * `latest` but the plugins do not, and FullCalendar fails at runtime on mixed
 * versions — do not bump one without the others.
 *
 * The luxon plugin is not optional. FullCalendar understands only 'local' and
 * 'UTC' on its own; handed a named zone without it, it silently falls back to
 * UTC and draws every event at its UTC wall time. That is what put a 01:24Z
 * call on the 12th in the grid while the rail — which uses the real zone —
 * correctly found nothing there.
 *
 * The built-in toolbar is off. The page owns the month title and the arrows so
 * they can be typeset like the rest of the app rather than like a widget.
 */
export function CalendarView({
  onOpen,
  view,
  controlRef,
  onRangeChange,
  categories,
  selectedDate,
  onSelectDay,
}: {
  onOpen: (source: string, id: string) => void
  view: CalendarViewName
  controlRef?: React.RefObject<CalendarControls | null>
  onRangeChange?: (start: Date) => void
  /** Which event categories to draw. Everything else is fetched but not shown. */
  categories: Set<EventCategory>
  /** The day the rail is showing, drawn with a ring. Null means today. */
  selectedDate?: Date | null
  onSelectDay?: (day: Date) => void
}) {
  const qc = useQueryClient()
  const calRef = React.useRef<any>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const { fmt, timezone } = useTimezone()
  const { calendarWeekStart } = useSettings()
  const tip = useHoverTip()

  /**
   * What a hovered event says. A squeezed block may show no text at all, so
   * this is the only place some events are legible — it carries the full title
   * and the real interval in every view, month and list included.
   */
  const tipFor = React.useCallback(
    (event: any) => {
      const when = event.allDay
        ? isoDayLabel(String(event.startStr).slice(0, 10))
        : [fmt(event.start, 'EEE d MMM, h:mm a'), event.end ? fmt(event.end, 'h:mm a') : null]
            .filter(Boolean)
            .join(' – ')
      const p = event.extendedProps ?? {}
      const meta = [p.project, p.who, p.kind].filter(Boolean).join(' · ')
      return (
        <>
          <div className="kb-tip-title">{event.title}</div>
          <div className="kb-tip-meta">{when}</div>
          {meta && <div className="kb-tip-meta">{meta}</div>}
        </>
      )
    },
    [fmt],
  )

  React.useEffect(() => {
    if (!controlRef) return
    controlRef.current = {
      prev: () => calRef.current?.getApi().prev(),
      next: () => calRef.current?.getApi().next(),
      today: () => calRef.current?.getApi().today(),
      refetch: () => calRef.current?.getApi().refetchEvents(),
    }
    return () => {
      controlRef.current = null
    }
  }, [controlRef])

  // FullCalendar keeps its own view state, so a change to the prop has to be
  // pushed into the instance rather than re-rendered into it.
  React.useEffect(() => {
    calRef.current?.getApi().changeView(view)
  }, [view])

  // Held in a ref so toggling a chip never re-creates the fetcher; FullCalendar
  // would hold on to the old one anyway, so the refetch below is what applies it.
  const catsRef = React.useRef(categories)
  catsRef.current = categories
  React.useEffect(() => {
    calRef.current?.getApi().refetchEvents()
  }, [categories])

  /**
   * The selection is painted onto the cell rather than driven through
   * `dayCellClassNames`: FullCalendar only re-runs that hook when it re-renders
   * the view, so a prop change alone would leave the ring on the old day. Cells
   * carry a `data-date` of their own, which is all this needs.
   */
  const selectedIso = selectedDate ? isoDay(selectedDate) : null
  const isoRef = React.useRef(selectedIso)
  isoRef.current = selectedIso

  const paintSelection = React.useCallback(() => {
    const root = rootRef.current
    if (!root) return
    root
      .querySelectorAll('.kb-day-selected')
      .forEach((el) => el.classList.remove('kb-day-selected'))
    if (!isoRef.current) return
    root.querySelector(`.fc-day[data-date="${isoRef.current}"]`)?.classList.add('kb-day-selected')
  }, [])

  // Both are needed: the effect covers a new selection, and datesSet covers the
  // cells being rebuilt under it when the month or the view changes.
  React.useEffect(paintSelection, [paintSelection, selectedIso, view])

  const fetchEvents = React.useCallback(async (info: { startStr: string; endStr: string }) => {
    const events = await api.get<CalendarEvent[]>(
      `/api/calendar?start=${encodeURIComponent(info.startStr)}&end=${encodeURIComponent(info.endStr)}`,
    )
    return events
      .filter((e) => catsRef.current.has(e.category))
      .map((e) => ({
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        // The pill paints itself from --ev, so FullCalendar's own fill is off.
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        editable: e.editable,
        extendedProps: { source: e.source, entityId: e.entityId, tint: e.color, ...e.meta },
      }))
  }, [])

  const reschedule = async (info: any) => {
    const { source, entityId } = info.event.extendedProps
    if (source === 'birthday') {
      info.revert()
      return
    }
    try {
      await api.patch('/api/calendar', {
        source,
        entityId,
        start: info.event.start?.toISOString(),
        end: info.event.end?.toISOString() ?? null,
      })
      toast.success('Rescheduled')
      qc.invalidateQueries()
    } catch (err) {
      info.revert()
      toast.error(err instanceof Error ? err.message : 'Could not reschedule')
    }
  }

  return (
    <div ref={rootRef} className="h-full">
      <FullCalendar
        ref={calRef}
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin]}
        initialView={view}
        timeZone={timezone}
        headerToolbar={false}
        /* Month sizes to its rows: a liquid height leaves dead space under the
         last week, since the grid will not stretch past its natural size. The
         time views do need a viewport-bound box, or they run 24 hours long. */
        height={view === 'dayGridMonth' ? 'auto' : '100%'}
        editable
        /* Overlapping events divide the day column between them rather than
         stacking with an offset. Staggering keeps the frontmost block readable
         but hides the ones behind it, and which one wins is just whichever
         sorts last; splitting the width shows every event honestly. Blocks get
         narrow when several collide — see EventChip, which clips its label so
         nothing paints outside its own shape, and the tooltip, which carries
         the detail a squeezed block cannot. */
        slotEventOverlap={false}
        /* A deadline or a note carries one instant, not a span, so the time views
         have nothing to size it from. Half an hour is the smallest slot the
         grid draws, which makes a point-in-time item read as one block rather
         than the hour-long bar FullCalendar defaults to. Display only: the
         event keeps a null end, so dropping it writes no duration. */
        defaultTimedEventDuration="00:30"
        /* The one-slot floor for short blocks is CSS (see .fc-timegrid-event-
         harness) and deliberately NOT `eventMinHeight`. FullCalendar folds that
         option into the pixel span it does overlap detection with — its own
         source marks the line `// :(` — so a floor even a fraction taller than
         a slot makes every short event bleed into the one after it and the two
         split the column as though they collided. A 9:00 follow-up and a 9:30
         meeting did exactly that for anyone whose root font size was under
         16px, which is where the slot pitch falls below 22px. */
        dayMaxEvents={3}
        nowIndicator
        fixedWeekCount={false}
        firstDay={calendarWeekStart === 'sunday' ? 0 : 1}
        dayHeaderFormat={{ weekday: 'short' }}
        /* Month cells carry their own date numbers; a week column has one nowhere
         else in the grid, so its header carries it. Appended by hand rather
         than asked of `dayHeaderFormat`, because Intl orders that field pair as
         "27 Thu" in en-US and a calendar column reads as "Thu 27". The marker
         Date keeps the calendar's date in its UTC fields — a local getter would
         take the number back a day for anyone west of Greenwich. */
        dayHeaderContent={(arg) =>
          arg.view.type === 'timeGridWeek' ? `${arg.text} ${arg.date.getUTCDate()}` : arg.text
        }
        moreLinkContent={(arg) => `+${arg.num} more`}
        events={fetchEvents as any}
        datesSet={(info) => {
          onRangeChange?.(info.view.currentStart)
          paintSelection()
        }}
        /* dateStr is the calendar's own day string; parsing the marker Date in the
         browser zone would land on the day before for anyone west of UTC. */
        dateClick={(info) => onSelectDay?.(localDay(info.dateStr.slice(0, 10)))}
        eventDrop={reschedule}
        eventResize={reschedule}
        eventClick={(info) => {
          const { source, entityId } = info.event.extendedProps as any
          onOpen(source, entityId)
        }}
        eventMouseEnter={(info) => tip.show(info.el, tipFor(info.event))}
        eventMouseLeave={tip.hide}
        eventDisplay="block"
        eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
        /* Pinned rather than left to the default so `blockTime` can split on the
         same string FullCalendar joins with. */
        defaultRangeSeparator={RANGE_SEP}
        eventContent={(arg) => {
          const tint = (arg.event.extendedProps as any).tint as string
          if (arg.view.type === 'listWeek') {
            return <span style={{ color: tint }}>{arg.event.title}</span>
          }
          // A month cell is about what happened, not when — clock times there
          // cost more width than they carry. The Today rail and the week views
          // are where the hour matters.
          const month = arg.view.type === 'dayGridMonth'
          return (
            <EventChip
              tint={tint}
              time={!month && !arg.event.allDay ? blockTime(arg) : null}
              title={arg.event.title}
            />
          )
        }}
      />
      {tip.node}
    </div>
  )
}

/** How FullCalendar joins the two ends of an interval, and how `blockTime` cuts it. */
const RANGE_SEP = ' - '

/**
 * What a week-view block's label says about time.
 *
 * A block shorter than one slot is floored to 30 minutes, so its height
 * overstates it — those keep both ends, because the label is the only thing
 * correcting the shape. Every longer block is drawn at its true height, which
 * already says what the end time would, and saying it twice is expensive: an
 * interval like "10:00am - 12:00pm" is wider than a day column, so it took the
 * whole row and left the title clipped to nothing. The tooltip prints the full
 * interval either way, in every view.
 */
function blockTime(arg: any) {
  const { start, end } = arg.event
  const floored = !end || end.getTime() - start.getTime() < 30 * 60_000
  return floored ? arg.timeText : arg.timeText.split(RANGE_SEP)[0]
}

/** An all-day day-string as prose. Built from the parts so no zone can shift it. */
function isoDayLabel(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return day
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** `YYYY-MM-DD` in local time — the shape FullCalendar puts on a day cell. */
function isoDay(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The inverse: a calendar day string back to local midnight. */
function localDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
