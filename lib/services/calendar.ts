import { prisma } from '../db'
import { NotFoundError } from '../errors'

import { monthDayInUTC } from '../format'
import { type CalendarEvent } from '../calendar-categories'
import { FOLLOWS_UP } from './edges'

/**
 * A due date is a day on a wall calendar, not an instant. Emitting it as a full
 * timestamp invites every consumer to render it in a zone, which moves it: a
 * target of Oct 5 stored at UTC midnight reads as Oct 4 anywhere west of
 * Greenwich. All-day events carry `YYYY-MM-DD` and nothing else.
 */
const dayString = (d: Date) => d.toISOString().slice(0, 10)

/**
 * FullCalendar reads an all-day `end` as **exclusive**: an event ending on the
 * 5th is drawn through the 4th. A due date is inclusive — the 5th *is* the last
 * day — so the boundary is pushed one day out on the way to the client, and
 * `inclusiveEnd` pulls it back on the way in. Without the pair, every span
 * rendered a day short and each resize wrote the exclusive end into the date
 * column, walking the deadline backwards one day per drag.
 */
const exclusiveEnd = (d: Date) => dayString(new Date(d.getTime() + 86_400_000))

/** Kinds that occupy a slot in the day rather than landing in an inbox. */
const ENCOUNTER_KINDS = new Set(['MEETING', 'CALL', 'IN_PERSON'])

const PRIORITY_COLOR: Record<string, string> = {
  LOW: '#8a8578',
  MEDIUM: '#697760',
  HIGH: '#ba8a42',
  URGENT: '#bd5b3f',
}

const KIND_COLOR: Record<string, string> = {
  EVENT: '#5b7f8c',
  NOTE: '#7a6a86',
  CALL: '#4a6572',
  EMAIL: '#697760',
  TEXT: '#5f7d6e',
  MEETING: '#8c5a4a',
  IN_PERSON: '#bd5b3f',
  SOCIAL: '#a06a86',
}

/** Follow-ups read as a commitment, so they borrow the warning hue. */
const FOLLOWUP_COLOR = '#ba8a42'

/** An entry nobody has written into. See `createFollowUp`. */
const unwritten = (bodyText: string) => bodyText.trim().length === 0

/**
 * One merged feed. Tasks and entries are draggable because their dates are
 * editable; birthdays are derived from the contact record and are not.
 */
export async function getCalendarEvents(
  owner: string,
  start: Date,
  end: Date,
): Promise<CalendarEvent[]> {
  const now = new Date()
  // Date-only columns sit at UTC midnight, which can fall a whole day outside a
  // window cut on the viewer's zone. Widened here; the day views narrow it back
  // down by comparing calendar days, which is the only comparison that means
  // anything for a due date.
  const dayStart = new Date(start.getTime() - 86_400_000)
  const dayEnd = new Date(end.getTime() + 86_400_000)
  const [tasks, entries, birthdays, projects] = await Promise.all([
    prisma.task.findMany({
      where: {
        owner,
        deletedAt: null,
        status: { not: 'ARCHIVED' },
        OR: [
          { dueDate: { gte: dayStart, lte: dayEnd } },
          { startDate: { gte: dayStart, lte: dayEnd } },
        ],
      },
      select: {
        id: true,
        title: true,
        startDate: true,
        dueDate: true,
        allDay: true,
        priority: true,
        status: true,
        project: { select: { name: true, color: true } },
      },
    }),
    prisma.entry.findMany({
      where: { owner, deletedAt: null, occurredAt: { gte: start, lte: end } },
      select: {
        id: true,
        title: true,
        kind: true,
        occurredAt: true,
        durationMin: true,
        bodyText: true,
        mentions: { select: { contact: { select: { displayName: true } } }, take: 3 },
      },
    }),
    prisma.contact.findMany({
      where: { owner, deletedAt: null, birthday: { not: null } },
      select: { id: true, displayName: true, birthday: true },
    }),
    prisma.project.findMany({
      where: {
        owner,
        deletedAt: null,
        status: { not: 'ARCHIVED' },
        OR: [
          { targetDate: { gte: dayStart, lte: dayEnd } },
          { startDate: { gte: dayStart, lte: dayEnd } },
        ],
      },
      select: {
        id: true,
        slug: true,
        name: true,
        color: true,
        startDate: true,
        targetDate: true,
        allDay: true,
      },
    }),
  ])

  // Which of the window's entries continue an earlier conversation. A
  // follow-up is an ordinary entry — the edge is the only thing that says so,
  // and it is what earns the ochre chip and a place on the agenda views.
  const followUpIds = new Set(
    (
      await prisma.entityEdge.findMany({
        where: {
          owner,
          relation: FOLLOWS_UP,
          sourceType: 'entry',
          sourceId: { in: entries.map((e) => e.id) },
        },
        select: { sourceId: true },
      })
    ).map((e) => e.sourceId),
  )

  const events: CalendarEvent[] = []

  for (const t of tasks) {
    const anchor = t.dueDate ?? t.startDate
    if (!anchor) continue
    events.push({
      id: `task:${t.id}`,
      title: t.title,
      // An all-day deadline is a band of calendar days and carries the
      // exclusive end FullCalendar expects; a timed one is an instant on the
      // grid and must keep its time of day, so it is published as-is.
      start: t.allDay ? dayString(t.startDate ?? anchor) : (t.startDate ?? anchor).toISOString(),
      end: !(t.startDate && t.dueDate)
        ? undefined
        : t.allDay
          ? exclusiveEnd(t.dueDate)
          : t.dueDate.toISOString(),
      allDay: t.allDay,
      source: 'task',
      category: 'deadline',
      entityId: t.id,
      color: t.project?.color || PRIORITY_COLOR[t.priority] || '#3b82f6',
      editable: true,
      meta: { priority: t.priority, status: t.status, project: t.project?.name ?? null },
    })
  }

  for (const e of entries) {
    const startAt = e.occurredAt
    const endAt = e.durationMin ? new Date(startAt.getTime() + e.durationMin * 60_000) : undefined
    const who = e.mentions.map((m) => m.contact.displayName).join(', ')
    // Future date wins over kind: an entry you dated forward is a plan. Two
    // exceptions.
    //
    // EVENT is a calendar item in its own right, so it stays an event once it
    // has happened rather than sliding into 'log' and disappearing behind the
    // chip that is off by default.
    //
    // A follow-up stays a follow-up past its date for as long as it is empty.
    // That is the whole point of making one an entry: an unwritten one is a
    // conversation that was promised and never had, and letting it decay into
    // 'log' would hide the open loop in the one category the calendar does not
    // show. Writing it up is what releases it into the ordinary history.
    const category =
      e.kind === 'EVENT'
        ? 'event'
        : followUpIds.has(e.id) && (startAt > now || unwritten(e.bodyText))
          ? 'followup'
          : startAt > now
            ? 'scheduled'
            : ENCOUNTER_KINDS.has(e.kind)
              ? 'meeting'
              : 'log'

    events.push({
      id: `entry:${e.id}`,
      title: e.title || (who ? `${e.kind.toLowerCase()} — ${who}` : e.kind.toLowerCase()),
      start: startAt.toISOString(),
      end: endAt?.toISOString(),
      allDay: false,
      source: 'entry',
      category,
      entityId: e.id,
      color: category === 'followup' ? FOLLOWUP_COLOR : (KIND_COLOR[e.kind] ?? '#8b5cf6'),
      editable: true,
      meta: { kind: e.kind, who },
    })
  }

  // A project with both dates is a band across the weeks it runs; with only one
  // it is the single date it has. Either way it is a commitment with a deadline,
  // so it shares the deadline category with tasks.
  for (const p of projects) {
    const anchor = p.targetDate ?? p.startDate
    if (!anchor) continue
    const spans = !!(p.startDate && p.targetDate)
    events.push({
      id: `project:${p.id}`,
      title: spans || p.targetDate ? p.name : `${p.name} starts`,
      start: p.allDay ? dayString(p.startDate ?? anchor) : (p.startDate ?? anchor).toISOString(),
      end: !spans
        ? undefined
        : p.allDay
          ? exclusiveEnd(p.targetDate!)
          : p.targetDate!.toISOString(),
      allDay: p.allDay,
      source: 'project',
      category: 'deadline',
      entityId: p.slug,
      color: p.color || '#697760',
      editable: true,
      meta: { project: p.name },
    })
  }

  // Birthdays repeat, so they are expanded across every year the view touches.
  // The years come from the *widened* window: occurrences are tested against
  // dayStart/dayEnd, so iterating start..end skipped a Dec 31 birthday sitting
  // in the extra edge day of the previous year — visible in the January view,
  // never generated.
  for (let year = dayStart.getUTCFullYear(); year <= dayEnd.getUTCFullYear(); year++) {
    for (const c of birthdays) {
      if (!c.birthday) continue
      const b = c.birthday
      const occurrence = monthDayInUTC(year, b.getUTCMonth(), b.getUTCDate())
      if (occurrence < dayStart || occurrence > dayEnd) continue
      events.push({
        id: `birthday:${c.id}:${year}`,
        title: `🎂 ${c.displayName}`,
        start: dayString(occurrence),
        allDay: true,
        source: 'birthday',
        category: 'milestone',
        entityId: c.id,
        color: '#a06a86',
        editable: false,
      })
    }
  }

  return events
}

/**
 * Where the far end of a span lands when only its start was dragged. Keeping
 * the original gap is what stops a two-week project collapsing to a single day
 * because the drop reported no end.
 */
const shiftedEnd = (from: Date, to: Date, movedTo: Date) =>
  new Date(movedTo.getTime() + (to.getTime() - from.getTime()))

/** Undoes `exclusiveEnd`: the client hands back the boundary it was given. */
const inclusiveEnd = (d: Date) => new Date(d.getTime() - 86_400_000)

/** Drag-to-reschedule. Only tasks and entries carry editable dates. */
export async function rescheduleEvent(
  owner: string,
  source: 'task' | 'entry' | 'project',
  entityId: string,
  start: Date,
  end?: Date | null,
) {
  // Dragged by its slug, the same id the feed handed out.
  if (source === 'project') {
    const project = await prisma.project.findFirst({
      where: { owner, slug: entityId },
      select: { id: true, startDate: true, targetDate: true, allDay: true },
    })
    if (!project) throw new NotFoundError()
    // A project with a span keeps its shape; one date just moves.
    if (project.startDate && project.targetDate) {
      return prisma.project.update({
        where: { id: project.id },
        data: {
          startDate: start,
          // Only an all-day end was widened on the way out, so only an all-day
          // end is narrowed on the way back.
          targetDate: end
            ? project.allDay
              ? inclusiveEnd(end)
              : end
            : shiftedEnd(project.startDate, project.targetDate, start),
        },
      })
    }
    return prisma.project.update({
      where: { id: project.id },
      data: project.targetDate ? { targetDate: start } : { startDate: start },
    })
  }

  if (source === 'task') {
    const task = await prisma.task.findFirst({
      where: { id: entityId, owner },
      select: { startDate: true, dueDate: true, allDay: true },
    })
    // Checked here, not left to the update: that one is keyed by id alone.
    if (!task) throw new NotFoundError()
    // A task with a span keeps its shape.
    if (task.startDate && task.dueDate) {
      return prisma.task.update({
        where: { id: entityId },
        data: {
          startDate: start,
          dueDate: end
            ? task.allDay
              ? inclusiveEnd(end)
              : end
            : shiftedEnd(task.startDate, task.dueDate, start),
        },
      })
    }
    // Otherwise whichever single date the card is actually drawn from is the
    // one that moves. Always writing `dueDate` grew a span on a task that only
    // had a start date, leaving the card anchored where it was dropped from.
    if (task.startDate && !task.dueDate) {
      return prisma.task.update({ where: { id: entityId }, data: { startDate: start } })
    }
    return prisma.task.update({ where: { id: entityId }, data: { dueDate: start } })
  }

  await prisma.entry.findFirstOrThrow({ where: { id: entityId, owner }, select: { id: true } })
  const durationMin = end
    ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000))
    : undefined
  return prisma.entry.update({
    where: { id: entityId },
    data: { occurredAt: start, ...(durationMin !== undefined ? { durationMin } : {}) },
  })
}
