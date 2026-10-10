'use client'
import * as React from 'react'
import { useClockNow } from '@/lib/hooks/platform'
import { CalendarClock, Link2, ListChecks, PenLine, Flag } from 'lucide-react'
import { differenceInCalendarDays, format } from 'date-fns'
import { Avatar } from '@/components/ui/misc'
import { useTimezone, useZonedToday } from '@/lib/hooks/settings'
import { zonedDayOf } from '@/lib/format'
import { calendarDate, cn } from '@/lib/utils'
import type { BoardTask } from '@/lib/api-types'

const PRIORITY: Record<string, { label: string; color: string }> = {
  LOW: { label: 'Low', color: 'var(--muted-foreground)' },
  MEDIUM: { label: 'Medium', color: 'var(--hue-2)' },
  HIGH: { label: 'High', color: 'var(--warning)' },
  URGENT: { label: 'Urgent', color: 'var(--destructive)' },
}

export function TaskCardFace({
  task,
  dragging,
  onOpen,
}: {
  task: BoardTask
  dragging?: boolean
  onOpen?: (task: BoardTask) => void
}) {
  const subtasks = task.subtasks ?? []
  const done = subtasks.filter((s) => s.status === 'DONE').length
  const pct = subtasks.length ? Math.round((done / subtasks.length) * 100) : 0
  // "Overdue" is a question about the calendar, so it has to be asked on the
  // user's calendar. date-fns' isPast/isToday answer it in the browser's zone,
  // which is a different day for part of every night.
  const today = useZonedToday()
  const now = useClockNow()
  const { fmt, timezone } = useTimezone()
  const allDay = task.allDay ?? true
  // Two different questions. An all-day deadline is overdue once the calendar
  // day has passed; a timed one is overdue the moment it passes, so "due at
  // noon" reads overdue from 12:01 rather than only tomorrow. Both are gated on
  // `today`, which is null until mount, so the server never renders a clock.
  const dueAt = task.dueDate ? new Date(task.dueDate) : null
  const due = task.dueDate
    ? allDay
      ? calendarDate(task.dueDate)
      : zonedDayOf(task.dueDate, timezone)
    : null
  const dueInDays = due && today ? differenceInCalendarDays(due, today) : null
  const overdue =
    task.status !== 'DONE' &&
    today !== null &&
    (allDay
      ? dueInDays !== null && dueInDays < 0
      : dueAt !== null && now !== null && dueAt.getTime() < now)
  const priority = PRIORITY[task.priority] ?? PRIORITY.MEDIUM
  const accent = task.project?.color ?? priority.color

  return (
    <article
      onClick={() => onOpen?.(task)}
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] transition-all',
        dragging
          ? '[box-shadow:var(--shadow-lift)] ring-2 ring-[var(--ring)]'
          : '[box-shadow:var(--shadow-card)] hover:-translate-y-0.5 hover:[box-shadow:var(--shadow-lift)]',
      )}
    >
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} />

      <div className="flex flex-col gap-2.5 p-3 pt-3.5">
        <div className="flex items-start justify-between gap-2">
          <h5 className="text-[13.5px] font-medium leading-snug">{task.title}</h5>
          {task.isDraft && (
            <span title="Needs details" className="mt-0.5 shrink-0">
              <PenLine className="h-3.5 w-3.5 text-[var(--pending)]" />
            </span>
          )}
        </div>

        {task.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-[var(--muted-foreground)]">
            {task.description}
          </p>
        )}

        {task.project && (
          <span
            className="inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{
              background: `color-mix(in oklch, ${task.project.color ?? 'var(--primary)'} 14%, transparent)`,
              color: task.project.color ?? 'var(--primary)',
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: task.project.color ?? 'var(--primary)' }}
            />
            {task.project.name}
          </span>
        )}

        {subtasks.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
              <span className="inline-flex items-center gap-1">
                <ListChecks className="h-3 w-3" /> Subtasks
              </span>
              <span>
                {done}/{subtasks.length}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: 'var(--hue-3)' }}
              />
            </div>
          </div>
        )}

        {(task.tags ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {task.tags.map((t) => (
              <span
                key={t.tagId}
                className="rounded-md bg-[var(--muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]"
              >
                #{t.tag.name}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2.5">
          {/* Status comes from the column, so this updates the moment a card is
              dropped somewhere else. */}
          {task.column && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                background: `color-mix(in oklch, ${task.column.color ?? 'var(--primary)'} 16%, transparent)`,
                color: task.column.color ?? 'var(--primary)',
              }}
            >
              {task.column.name}
            </span>
          )}

          <span
            className="inline-flex items-center gap-1 text-[11px] font-medium"
            style={{ color: priority.color }}
          >
            <Flag className="h-3 w-3" /> {priority.label}
          </span>

          {due && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[11px]',
                overdue
                  ? 'font-medium text-[var(--destructive)]'
                  : 'text-[var(--muted-foreground)]',
              )}
              title={allDay || !dueAt ? format(due, 'PPP') : fmt(dueAt, 'PPP, h:mm a')}
            >
              <CalendarClock className="h-3 w-3" />
              {dueInDays === 0
                ? allDay || !dueAt
                  ? 'Today'
                  : fmt(dueAt, 'h:mm a')
                : overdue
                  ? `${Math.abs(dueInDays!)}d over`
                  : allDay || !dueAt
                    ? format(due, 'MMM d')
                    : fmt(dueAt, 'MMM d, h:mm a')}
            </span>
          )}

          {task._count?.refs > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
              <Link2 className="h-3 w-3" />
              {task._count.refs}
            </span>
          )}

          <span className="flex-1" />

          {(task.assignees ?? []).length > 0 && (
            <div className="flex -space-x-1.5">
              {task.assignees.slice(0, 3).map((a) => (
                <span
                  key={a.id}
                  title={a.contact.displayName}
                  className="rounded-full ring-2 ring-[var(--card)]"
                >
                  <Avatar src={a.contact.avatarUrl} name={a.contact.displayName} size={22} />
                </span>
              ))}
              {task.assignees.length > 3 && (
                <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[var(--muted)] text-[9px] font-medium ring-2 ring-[var(--card)]">
                  +{task.assignees.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

/* SortableTaskCard was removed on 2026-08-31. Its job -- wiring useSortable
   around a card -- moved into the shared board kit as `SortableCard`
   (components/board/kit/sortable-card.tsx), which is generic over what it
   wraps. This file keeps only the card's FACE, which is the part that is
   Kinship's and not shareable. */
