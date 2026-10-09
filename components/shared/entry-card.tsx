'use client'
import * as React from 'react'
import Link from 'next/link'
import {
  Phone,
  Mail,
  MessageSquare,
  Users,
  Handshake,
  NotebookPen,
  AtSign,
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  MapPin,
  CalendarClock,
  FolderKanban,
  Pencil,
  CornerUpLeft,
} from 'lucide-react'
import { useTimezone } from '@/lib/hooks/settings'
import { Card, Badge, Avatar } from '@/components/ui/misc'
import { EntryBody } from './entry-body'
import { EntryEditDialog } from './entry-edit-dialog'
import { cn, entryTitle } from '@/lib/utils'

export const KIND_ICON: Record<string, any> = {
  NOTE: NotebookPen,
  CALL: Phone,
  EMAIL: Mail,
  TEXT: MessageSquare,
  MEETING: Users,
  IN_PERSON: Handshake,
  SOCIAL: AtSign,
}

/**
 * Warm family only. These are the same hexes the calendar feed uses, so one
 * meeting is the same colour in the activity list and in the month grid.
 */
export const KIND_COLOR: Record<string, string> = {
  NOTE: '#7a6a86',
  CALL: '#4a6572',
  EMAIL: '#697760',
  TEXT: '#5f7d6e',
  MEETING: '#8c5a4a',
  IN_PERSON: '#bd5b3f',
  SOCIAL: '#a06a86',
}

/**
 * `editable` is on by default: the card is the only place an entry is shown, so
 * turning editing off here is what leaves a note readable but unfixable.
 */
export function EntryCard({
  entry,
  compact,
  editable = true,
}: {
  entry: any
  compact?: boolean
  editable?: boolean
}) {
  const { fmt } = useTimezone()
  const [editing, setEditing] = React.useState(false)
  const Icon = KIND_ICON[entry.kind] ?? NotebookPen
  const color = KIND_COLOR[entry.kind] ?? '#7a6a86'

  // A follow-up whose date has passed with nothing written into it is a
  // conversation that was promised and never had. Nothing else in the app
  // records that, and an empty card on its own does not read as a problem.
  const openLoop =
    !!entry.followsUp && !entry.bodyText?.trim() && new Date(entry.occurredAt) <= new Date()

  // A follow-up dated ahead of now has not happened yet, however much of it is
  // already drafted into the note, so it reads as a commitment rather than a
  // record. Only once that moment passes does the label move to the past tense.
  const followUpLabel = !entry.followUp
    ? null
    : new Date(entry.followUp.occurredAt) > new Date()
      ? 'Follow-up scheduled for'
      : entry.followUp.written
        ? 'Followed up'
        : 'Follow-up'

  return (
    <Card className="group/entry overflow-hidden p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className="inline-flex h-6 w-6 items-center justify-center rounded-md"
          style={{ background: `color-mix(in oklch, ${color} 20%, transparent)`, color }}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>

        <Link
          href={`/notes/${entry.id}`}
          className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
        >
          {entryTitle(entry)}
        </Link>

        {entry.direction === 'INBOUND' && (
          <Badge>
            <ArrowDownLeft className="h-3 w-3" />
            in
          </Badge>
        )}
        {entry.direction === 'OUTBOUND' && (
          <Badge>
            <ArrowUpRight className="h-3 w-3" />
            out
          </Badge>
        )}
        {entry.durationMin != null && (
          <Badge>
            <Clock className="h-3 w-3" />
            {entry.durationMin}m
          </Badge>
        )}
        {entry.location && (
          <Badge>
            <MapPin className="h-3 w-3" />
            {entry.location}
          </Badge>
        )}
        {entry.project && (
          <Link
            href={`/projects/${entry.project.slug}`}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-75"
            style={{
              borderColor: `color-mix(in oklch, ${entry.project.color ?? 'var(--primary)'} 45%, transparent)`,
              color: entry.project.color ?? 'var(--primary)',
            }}
          >
            <FolderKanban className="h-3 w-3" />
            {entry.project.name}
          </Link>
        )}

        <span className="ml-auto shrink-0 text-xs text-[var(--muted-foreground)]">
          {fmt(entry.occurredAt, 'MMM d, yyyy · HH:mm')}
        </span>

        {editable && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${entryTitle(entry)}`}
            title="Edit entry"
            className="shrink-0 rounded-md p-1 text-[var(--muted-foreground)] opacity-70 transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] hover:opacity-100 focus-visible:opacity-100"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}

        {(entry.followsUp || entry.followUp || openLoop) && (
          <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {entry.followsUp && (
              <Link
                href={`/notes/${entry.followsUp.id}`}
                className="inline-flex items-center gap-1 text-[var(--muted-foreground)] hover:underline"
              >
                <CornerUpLeft className="h-3 w-3" />
                Follows up {entryTitle(entry.followsUp)}
              </Link>
            )}
            {entry.followUp && (
              <Link
                href={`/notes/${entry.followUp.id}`}
                className="inline-flex items-center gap-1 font-medium text-[var(--warning)] hover:underline"
              >
                <CalendarClock className="h-3 w-3" />
                {followUpLabel} {fmt(entry.followUp.occurredAt, 'MMM d, yyyy')}
              </Link>
            )}
            {openLoop && (
              <span
                className="font-medium text-[var(--warning)]"
                title="This follow-up has never been written up"
              >
                Not written up
              </span>
            )}
          </div>
        )}
      </div>

      {/* Always the rich document — the flattened text loses lists, emphasis,
          links and the people/task chips. */}
      <EntryBody doc={entry.bodyJson} compact={compact} />

      {(entry.mentions?.length > 0 || entry.refs?.length > 0 || entry.tags?.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-2.5">
          {(entry.mentions ?? []).map((m: any) => (
            <Link
              key={m.id}
              href={`/contacts/${m.contact.slug}`}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[11px] transition-colors hover:bg-[var(--accent)]"
            >
              <Avatar src={m.contact.avatarUrl} name={m.contact.displayName} size={14} />
              {m.contact.displayName}
            </Link>
          ))}
          {(entry.refs ?? []).map((r: any) => (
            <Link
              key={r.id}
              href={r.project ? `/projects/${r.project.slug}` : `/board?task=${r.taskId}`}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-1.5 py-0.5 text-[11px] transition-colors hover:bg-[var(--accent)]"
            >
              {r.project ? r.project.name : (r.task?.title ?? 'task')}
            </Link>
          ))}
          {(entry.tags ?? []).map((t: any) => (
            <span
              key={t.tagId}
              className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--muted-foreground)]"
            >
              #{t.tag.name}
            </span>
          ))}
        </div>
      )}

      {/* Mounted only while open so the editor is seeded from the current body
          every time, rather than from whatever it held on the first edit. */}
      {editing && <EntryEditDialog entry={entry} open onOpenChange={setEditing} />}
    </Card>
  )
}
