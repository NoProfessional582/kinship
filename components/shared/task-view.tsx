'use client'
import * as React from 'react'
import Link from 'next/link'
import { differenceInCalendarDays, format } from 'date-fns'
import {
  AlignLeft,
  CalendarClock,
  Flag,
  ListChecks,
  NotebookPen,
  Users,
  CornerUpLeft,
  Check,
} from 'lucide-react'
import { Card, Avatar, Badge } from '@/components/ui/misc'
import { useTimezone, useZonedToday } from '@/lib/hooks/settings'
import { zonedDayOf } from '@/lib/format'
import { calendarDate, cn, entryTitle } from '@/lib/utils'

const PRIORITY: Record<string, { label: string; color: string }> = {
  LOW: { label: 'Low', color: 'var(--muted-foreground)' },
  MEDIUM: { label: 'Medium', color: 'var(--hue-2)' },
  HIGH: { label: 'High', color: 'var(--warning)' },
  URGENT: { label: 'Urgent', color: 'var(--destructive)' },
}

/**
 * Read-only presentation of a task — the surface you land on when you open a
 * card, with the editor one click away.
 *
 * Opening straight into a form made every visit an edit session: the fields
 * were laid out for entering values, not for reading them, so answering "what
 * is this and when is it due" meant scanning eight inputs. This shows the same
 * record as prose and pills, and leaves the form for when you actually mean to
 * change something.
 */
export function TaskView({
  task,
  entries,
  onOpenTask,
}: {
  task: any
  entries?: any[]
  onOpenTask?: (id: string) => void
}) {
  const { fmt, timezone } = useTimezone()
  const today = useZonedToday()

  const allDay = task.allDay ?? true
  const priority = PRIORITY[task.priority] ?? PRIORITY.MEDIUM
  const done = task.status === 'DONE'

  // Same two questions the board card asks, asked the same way: an all-day
  // deadline lapses when the calendar day does, a timed one the moment it
  // passes. Both gated on `today`, which is null until mount.
  const dueAt = task.dueDate ? new Date(task.dueDate) : null
  const due = task.dueDate
    ? allDay
      ? calendarDate(task.dueDate)
      : zonedDayOf(task.dueDate, timezone)
    : null
  const dueInDays = due && today ? differenceInCalendarDays(due, today) : null
  const overdue =
    !done &&
    today !== null &&
    (allDay ? dueInDays !== null && dueInDays < 0 : dueAt !== null && dueAt.getTime() < Date.now())

  // `calendarDate` returns null for an unparseable value, so neither label
  // assumes it got a date back.
  const showDate = (value: string | null) => {
    if (!value) return null
    if (!allDay) return fmt(value, 'EEE, MMM d, yyyy · h:mm a')
    const day = calendarDate(value)
    return day ? format(day, 'EEE, MMM d, yyyy') : null
  }
  const shortDay = (value: string) => {
    const day = calendarDate(value)
    return day ? format(day, 'MMM d') : null
  }

  const subtasks = task.subtasks ?? []
  const subDone = subtasks.filter((s: any) => s.status === 'DONE').length
  const pct = subtasks.length ? Math.round((subDone / subtasks.length) * 100) : 0
  const assignees = task.assignees ?? []
  const tags = task.tags ?? []
  const mentioned = entries ?? []

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------------------------------------------ hero */}
      <div className="flex flex-col gap-2.5">
        {task.parent && (
          <button
            type="button"
            onClick={() => onOpenTask?.(task.parent.id)}
            className="inline-flex w-fit items-center gap-1.5 text-[11px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <CornerUpLeft className="h-3 w-3" />
            <span className="truncate">{task.parent.title}</span>
          </button>
        )}

        <h2
          className={cn(
            'text-[22px] font-semibold leading-snug tracking-tight',
            done && 'text-[var(--muted-foreground)] line-through decoration-1',
          )}
        >
          {task.title}
        </h2>

        <div className="flex flex-wrap items-center gap-1.5">
          {task.column && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
              style={{
                background: `color-mix(in oklch, ${task.column.color ?? 'var(--primary)'} 16%, transparent)`,
                color: task.column.color ?? 'var(--primary)',
              }}
            >
              {done && <Check className="h-3 w-3" />}
              {task.column.name}
            </span>
          )}

          <span
            className="inline-flex items-center gap-1 text-[11px] font-medium"
            style={{ color: priority.color }}
          >
            <Flag className="h-3 w-3" /> {priority.label}
          </span>

          {task.project && (
            <Link
              href={`/projects/${task.project.slug}`}
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-80"
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
            </Link>
          )}

          {task.isDraft && (
            <Badge className="border-[var(--pending)] text-[var(--pending)]">needs details</Badge>
          )}
        </div>
      </div>

      {/* ----------------------------------------------------------- dates */}
      {(task.dueDate || task.startDate || task.completedAt) && (
        <Card className="grid grid-cols-1 gap-x-4 gap-y-2.5 p-3.5 sm:grid-cols-2">
          {task.startDate && <Fact label="Starts" value={showDate(task.startDate)} />}
          {task.dueDate && (
            <Fact
              label="Due"
              value={showDate(task.dueDate)}
              tone={overdue ? 'var(--destructive)' : undefined}
              note={
                dueInDays === null
                  ? undefined
                  : overdue
                    ? `${Math.abs(dueInDays)} day${Math.abs(dueInDays) === 1 ? '' : 's'} overdue`
                    : dueInDays === 0
                      ? 'Today'
                      : dueInDays === 1
                        ? 'Tomorrow'
                        : `in ${dueInDays} days`
              }
              icon={CalendarClock}
            />
          )}
          {task.completedAt && (
            <Fact
              label="Completed"
              value={fmt(task.completedAt, 'EEE, MMM d, yyyy')}
              tone="var(--success)"
            />
          )}
        </Card>
      )}

      {/* ----------------------------------------------------- description */}
      <Block title="Description" icon={AlignLeft} hue="var(--hue-2)">
        {task.description ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {task.description}
          </p>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">
            Nothing written yet — hit Edit to add the detail you will want when you come back to
            this.
          </p>
        )}
      </Block>

      {/* -------------------------------------------------------- subtasks */}
      {subtasks.length > 0 && (
        <Block
          title={`Subtasks · ${subDone}/${subtasks.length}`}
          icon={ListChecks}
          hue="var(--hue-3)"
        >
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, background: 'var(--hue-3)' }}
            />
          </div>
          <ul className="flex flex-col">
            {subtasks.map((s: any) => {
              const sDone = s.status === 'DONE'
              const sDue = s.dueDate ? shortDay(s.dueDate) : null
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onOpenTask?.(s.id)}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-[var(--muted)]"
                  >
                    <span
                      className={cn(
                        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border',
                        sDone
                          ? 'border-[var(--success)] bg-[var(--success)]'
                          : 'border-[var(--border)]',
                      )}
                    >
                      {sDone && <Check className="h-2.5 w-2.5 text-white" />}
                    </span>
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-sm',
                        sDone && 'text-[var(--muted-foreground)] line-through decoration-1',
                      )}
                    >
                      {s.title}
                    </span>
                    {sDue && (
                      <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">
                        {sDue}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </Block>
      )}

      {/* ---------------------------------------------------------- people */}
      {assignees.length > 0 && (
        <Block title="Assigned to" icon={Users} hue="var(--hue-5)">
          <ul className="flex flex-col gap-0.5">
            {assignees.map((a: any) => (
              <li key={a.id}>
                <Link
                  href={`/contacts/${a.contact.slug}`}
                  className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-[var(--muted)]"
                >
                  <Avatar src={a.contact.avatarUrl} name={a.contact.displayName} size={26} />
                  <span className="min-w-0 flex-1 truncate text-sm">{a.contact.displayName}</span>
                  {a.role && (
                    <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">
                      {a.role}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {/* ----------------------------------------------------- mentioned in */}
      {mentioned.length > 0 && (
        <Block
          title={`Mentioned in ${mentioned.length} note${mentioned.length === 1 ? '' : 's'}`}
          icon={NotebookPen}
          hue="var(--hue-6)"
        >
          <ul className="flex flex-col gap-0.5">
            {mentioned.map((e: any) => (
              <li key={e.id}>
                <Link
                  href={`/notes/${e.id}`}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-[var(--muted)]"
                >
                  <NotebookPen className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate">{entryTitle(e)}</span>
                  <span className="shrink-0 text-[11px] text-[var(--muted-foreground)]">
                    {fmt(e.occurredAt, 'MMM d')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {/* ------------------------------------------------------------ tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((t: any) => (
            <span
              key={t.tagId ?? t.tag?.id}
              className="rounded-md bg-[var(--muted)] px-1.5 py-0.5 text-[11px] text-[var(--muted-foreground)]"
            >
              #{t.tag?.name ?? t.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function Fact({
  label,
  value,
  note,
  tone,
  icon: Icon,
}: {
  label: string
  value: string | null
  note?: string
  tone?: string
  icon?: any
}) {
  if (!value) return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </span>
      <span className="text-sm" style={tone ? { color: tone, fontWeight: 500 } : undefined}>
        {value}
      </span>
      {note && (
        <span
          className="text-[11px]"
          style={tone ? { color: tone } : { color: 'var(--muted-foreground)' }}
        >
          {note}
        </span>
      )}
    </div>
  )
}

/** Mirrors the dossier's section card, so a task reads like a contact does. */
function Block({
  title,
  icon: Icon,
  hue,
  children,
}: {
  title: string
  icon: any
  hue: string
  children: React.ReactNode
}) {
  return (
    <Card className="overflow-hidden">
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ background: `color-mix(in oklch, ${hue} 10%, transparent)` }}
      >
        <Icon className="h-3.5 w-3.5" style={{ color: hue }} />
        <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: hue }}>
          {title}
        </h3>
      </div>
      <div className="p-4">{children}</div>
    </Card>
  )
}
