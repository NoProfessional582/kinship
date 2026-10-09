'use client'
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Section, MEmpty, MList, MRow } from '@/components/mobile/bits'
import { MobileCapture } from '@/components/mobile/capture'
import { KIND_ICON, KIND_COLOR } from '@/components/shared/entry-card'
import { ENTRY_KINDS } from '@/components/entity-modal/entry-form'
import { api } from '@/lib/hooks/api'
import { useTimezone } from '@/lib/hooks/settings'
import { entryTitle, cn } from '@/lib/utils'
import { m } from '@/lib/mobile/href'

/**
 * The feed. Same two-list split as the desktop page — a conversation you have
 * merely planned must not lead a log of what happened, but hiding it entirely
 * is how a follow-up booked for next month becomes invisible until the day it
 * arrives — with the kind filter as a scrolling chip track rather than a
 * labelled select, since a phone has no room for a filter bar with a caption.
 */
export default function MobileNotes() {
  const [kind, setKind] = React.useState('')
  const { fmt } = useTimezone()

  const query = (extra: string) => {
    const params = [kind && `kind=${kind}`, extra].filter(Boolean).join('&')
    return api.get<any[]>(`/api/entries${params ? `?${params}` : ''}`)
  }

  const { data: upcoming } = useQuery({
    queryKey: ['entries', kind, 'upcoming'],
    queryFn: () => query('upcoming=1'),
  })
  const { data: entries, isLoading } = useQuery({
    queryKey: ['entries', kind, 'past'],
    queryFn: () => query('past=1'),
  })

  const row = (e: any) => {
    const Icon = KIND_ICON[e.kind] ?? KIND_ICON.NOTE
    return (
      <MRow
        key={e.id}
        href={m(`/notes/${e.id}`)}
        lead={<Icon className="h-4 w-4" style={{ color: KIND_COLOR[e.kind] }} />}
        title={entryTitle(e)}
        sub={
          e.mentions?.length
            ? e.mentions
                .map((x: any) => x.contact?.displayName)
                .filter(Boolean)
                .join(', ')
            : undefined
        }
        meta={fmt(e.occurredAt, 'MMM d')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <MobileCapture />

      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
        <Chip active={kind === ''} onClick={() => setKind('')}>
          All
        </Chip>
        {ENTRY_KINDS.map((k) => (
          <Chip key={k.value} active={kind === k.value} onClick={() => setKind(k.value)}>
            {k.label}
          </Chip>
        ))}
      </div>

      {(upcoming?.length ?? 0) > 0 && (
        <Section title="Planned">
          <MList>{upcoming!.map(row)}</MList>
        </Section>
      )}

      <Section title="Archive">
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-[var(--muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {!isLoading && (entries?.length ?? 0) === 0 && <MEmpty>Nothing here yet.</MEmpty>}
        <MList>{entries?.map(row)}</MList>
      </Section>
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'kb-tap-inline shrink-0 rounded-full border px-3 text-xs transition-colors',
        active
          ? 'border-transparent bg-[var(--primary)] text-white'
          : 'border-[var(--border)] text-[var(--muted-foreground)]',
      )}
    >
      {children}
    </button>
  )
}
