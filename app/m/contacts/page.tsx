'use client'
import * as React from 'react'
import { Loader2, Search, Plus } from 'lucide-react'
import { MEmpty, MList, MRow, MTile } from '@/components/mobile/bits'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/ui/misc'
import { useContacts } from '@/lib/hooks/api'
import { CADENCE_LABEL } from '@/lib/cadence'
import { m } from '@/lib/mobile/href'

/**
 * People, as a scan list.
 *
 * The desktop page is a 2-to-4 column card grid with per-tile actions; at
 * 412px a single readable column beats one column of cards built for three.
 * Search is the header rather than a `w-56` field inside one.
 */
export default function MobileContacts() {
  const [q, setQ] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200)
    return () => clearTimeout(t)
  }, [q])

  const { data: contacts, isLoading } = useContacts(debounced)

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people…"
          className="h-11 w-full pl-9"
          type="search"
        />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}
      {!isLoading && (contacts?.length ?? 0) === 0 && (
        <MEmpty>{debounced ? `Nobody matches “${debounced}”.` : 'No people yet.'}</MEmpty>
      )}

      {(contacts?.length ?? 0) > 0 && (
        <MTile>
          <MList>
            {contacts!.map((c: any) => (
              <MRow
                key={c.id}
                href={m(`/contacts/${c.slug}`)}
                lead={<Avatar name={c.displayName} src={c.avatarUrl} size={36} />}
                title={c.displayName}
                sub={[c.jobTitle, c.company].filter(Boolean).join(' · ') || undefined}
                meta={
                  c.cadence && c.cadence !== 'NONE'
                    ? CADENCE_LABEL[c.cadence as keyof typeof CADENCE_LABEL]
                    : undefined
                }
                chevron
              />
            ))}
          </MList>
        </MTile>
      )}
    </div>
  )
}
