'use client'
import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Trash2, Link2 } from 'lucide-react'
import { EntryCard } from '@/components/shared/entry-card'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/misc'
import { NotFound } from '@/components/shared/not-found'
import { api } from '@/lib/hooks/api'
import { relationLabel } from '@/lib/relations'
import type { Edge, EntryDetail } from '@/lib/api-types'

export default function EntryPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()

  const {
    data: entry,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['entry', id],
    queryFn: () => api.get<EntryDetail>(`/api/entries/${id}`),
  })

  // Edges are a free-standing table, so they arrive on their own rather than
  // inside the entry. This is where a follow-up chain is actually readable:
  // the card carries one hop in each direction, the panel carries every link.
  const { data: edges } = useQuery({
    queryKey: ['edges', 'entry', id],
    queryFn: () => api.get<Edge[]>(`/api/edges?type=entry&id=${id}`),
    // Asked once the entry is known to exist, so an unknown id is refused once, not twice.
    enabled: Boolean(entry),
  })

  const remove = async () => {
    try {
      await api.del(`/api/entries/${id}`)
      qc.invalidateQueries()
      toast.success('Entry deleted')
      router.push('/notes')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  return (
    <div className="mx-auto max-w-[var(--page-max)] px-6 py-6 lg:px-8">
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>
        <div className="flex-1" />
        {entry && (
          <Button variant="ghost" size="icon" onClick={remove} title="Delete entry">
            <Trash2 className="h-4 w-4 text-[var(--destructive)]" />
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}
      {!isLoading && !entry && <NotFound error={error} what="Note" href="/notes" back="Notes" />}
      {entry && <EntryCard entry={entry} />}

      {entry && (edges ?? []).length > 0 && (
        <Card className="mt-3 p-4">
          <h2 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
            <Link2 className="h-3 w-3" /> Linked
          </h2>
          <div className="flex flex-col gap-1.5">
            {(edges ?? []).map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-sm">
                <span className="w-[7rem] shrink-0 text-[11px] text-[var(--muted-foreground)]">
                  {relationLabel(e.relation, e.direction)}
                </span>
                <Link href={e.href} className="min-w-0 flex-1 break-words hover:underline">
                  {e.label}
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
