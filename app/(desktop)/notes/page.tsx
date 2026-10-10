'use client'
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { NotebookPen, Loader2, CalendarClock } from 'lucide-react'
import { UnifiedComposer } from '@/components/composer/unified-composer'
import { EntryCard } from '@/components/shared/entry-card'
import { EmptyState } from '@/components/ui/misc'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/hooks/api'
import type { EntryListItem } from '@/lib/api-types'

export default function NotesPage() {
  const [kind, setKind] = React.useState('')

  // Two lists, one feed. The archive below is a log of what happened, so a
  // conversation you have merely planned must not lead it — but hiding it
  // entirely is how a follow-up you booked for next month becomes invisible
  // until the day it arrives. It gets its own group at the top instead.
  const query = (extra: string) => {
    const params = [kind && `kind=${kind}`, extra].filter(Boolean).join('&')
    return api.get<EntryListItem[]>(`/api/entries${params ? `?${params}` : ''}`)
  }

  const { data: upcoming } = useQuery({
    queryKey: ['entries', kind, 'upcoming'],
    queryFn: () => query('upcoming=1'),
  })

  const { data: entries, isLoading } = useQuery({
    queryKey: ['entries', kind, 'past'],
    queryFn: () => query('past=1'),
  })

  return (
    <div className="mx-auto max-w-[var(--page-max)] px-6 py-6 lg:px-8">
      <header className="mb-4 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <NotebookPen className="h-4 w-4" /> Notes & communications
          </h1>
          <p className="text-xs text-[var(--muted-foreground)]">
            Type <strong>@</strong> to tag a person and <strong>[[</strong> for a task or project —
            anything new gets created as you write.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Filter</Label>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="h-8 w-36 text-xs"
          >
            <option value="">All kinds</option>
            {['NOTE', 'CALL', 'EMAIL', 'TEXT', 'MEETING', 'IN_PERSON', 'SOCIAL', 'EVENT'].map(
              (k) => (
                <option key={k} value={k}>
                  {k.replace('_', ' ').toLowerCase()}
                </option>
              ),
            )}
          </Select>
        </div>
      </header>

      <UnifiedComposer />

      {(upcoming ?? []).length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
            <CalendarClock className="h-3 w-3" /> Upcoming
          </h2>
          <div className="flex flex-col gap-3">
            {(upcoming ?? []).map((e) => (
              <EntryCard key={e.id} entry={e} />
            ))}
          </div>
        </section>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {!isLoading && (entries ?? []).length === 0 && (upcoming ?? []).length === 0 && (
          <EmptyState
            icon={NotebookPen}
            title="Nothing captured yet"
            hint="Write your first note above."
          />
        )}
        {(entries ?? []).map((e) => (
          <EntryCard key={e.id} entry={e} />
        ))}
      </div>
    </div>
  )
}
