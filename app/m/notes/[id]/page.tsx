'use client'
import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Trash2, Pencil, Link2, MapPin, Clock } from 'lucide-react'
import { EntryBody } from '@/components/shared/entry-body'
import { Section, MList, MRow } from '@/components/mobile/bits'
import { MobileEntryEditSheet } from '@/components/mobile/entry-edit-sheet'
import { KIND_ICON, KIND_COLOR } from '@/components/shared/entry-card'
import { api } from '@/lib/hooks/api'
import { relationLabel } from '@/lib/relations'
import { useTimezone } from '@/lib/hooks/settings'
import { entryTitle } from '@/lib/utils'
import { m } from '@/lib/mobile/href'

/** One entry, read first and edited from a sheet. */
export default function MobileEntry() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const { fmt } = useTimezone()
  const [editing, setEditing] = React.useState(false)

  const { data: entry, isLoading } = useQuery({
    queryKey: ['entry', id],
    queryFn: () => api.get<any>(`/api/entries/${id}`),
  })

  // Edges are a free-standing table, so they arrive on their own rather than
  // inside the entry. This is where a follow-up chain becomes readable.
  const { data: edges } = useQuery({
    queryKey: ['edges', 'entry', id],
    queryFn: () => api.get<any[]>(`/api/edges?type=entry&id=${id}`),
  })

  const remove = async () => {
    try {
      await api.del(`/api/entries/${id}`)
      qc.invalidateQueries()
      toast.success('Entry deleted')
      router.push(m('/notes'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  if (isLoading || !entry) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  const Icon = KIND_ICON[entry.kind] ?? KIND_ICON.NOTE

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.back()}
          className="kb-tap -ml-1 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <span className="flex-1" />
        <button
          onClick={() => setEditing(true)}
          aria-label="Edit entry"
          className="kb-tap flex items-center justify-center rounded-[var(--radius-md)] text-[var(--muted-foreground)]"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={remove}
          aria-label="Delete entry"
          className="kb-tap flex items-center justify-center rounded-[var(--radius-md)] text-[var(--destructive)]"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <header>
        <p
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.13em]"
          style={{ color: KIND_COLOR[entry.kind] }}
        >
          <Icon className="h-3.5 w-3.5" /> {String(entry.kind).toLowerCase().replace(/_/g, ' ')}
        </p>
        <h1 className="mt-1 text-[1.35rem] leading-tight">{entryTitle(entry)}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[var(--muted-foreground)]">
          <span>{fmt(entry.occurredAt, 'EEE, MMM d yyyy · HH:mm')}</span>
          {entry.durationMin && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {entry.durationMin}m
            </span>
          )}
          {entry.location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {entry.location}
            </span>
          )}
        </p>
        {(entry.mentions?.length ?? 0) > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {entry.mentions.map(
              (x: any) =>
                x.contact && (
                  <Link
                    key={x.contact.id}
                    href={m(`/contacts/${x.contact.slug}`)}
                    className="kb-tap-inline rounded-full border border-[var(--border)] bg-[var(--card)] px-3 text-[11px]"
                  >
                    {x.contact.displayName}
                  </Link>
                ),
            )}
          </div>
        )}
      </header>

      <article className="prose-sm">
        <EntryBody doc={entry.bodyJson} />
      </article>

      {(edges?.length ?? 0) > 0 && (
        <Section title="Linked">
          <MList>
            {edges!.map((e: any) => (
              /* The service builds desktop hrefs (/notes/x, /contacts/y);
                 m() keeps the tap inside the mobile tree. */
              <MRow
                key={e.id}
                href={m(e.href)}
                lead={<Link2 className="h-4 w-4 text-[var(--muted-foreground)]" />}
                title={e.label}
                sub={relationLabel(e.relation, e.direction)}
                chevron
              />
            ))}
          </MList>
        </Section>
      )}

      {editing && <MobileEntryEditSheet entry={entry} open={editing} onOpenChange={setEditing} />}
    </div>
  )
}
