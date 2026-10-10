'use client'
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Search, Loader2 } from 'lucide-react'
import { Avatar } from '@/components/ui/misc'
import { api } from '@/lib/hooks/api'
import { cn } from '@/lib/utils'
import type { MentionSuggestion } from '@/lib/services/search'

export interface ContactRef {
  id: string
  displayName: string
  avatarUrl?: string | null
}

/**
 * Type-ahead multi-select over contacts.
 *
 * Replaces the toggle-every-contact grid the assignee field used to be: that
 * shape is fine for a demo network and unusable at 199 people, where the list
 * outgrew the panel it lived in. This asks the same `/api/search/mentions`
 * endpoint the `@` dropdown uses, so a name typed here ranks the same way it
 * does in the composer — prefix first, then trigram similarity, so a
 * misspelling still finds the person.
 *
 * Selected people travel as `ContactRef`, not bare ids: the chip has to render
 * a name, and the search results only ever contain the current query's matches.
 */
export function ContactPicker({
  value,
  onChange,
  placeholder = 'Search people…',
  emptyHint,
}: {
  value: ContactRef[]
  onChange: (next: ContactRef[]) => void
  placeholder?: string
  emptyHint?: string
}) {
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const boxRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Debounced so a fast typist does not fire a query per keystroke.
  const [debounced, setDebounced] = React.useState('')
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150)
    return () => clearTimeout(t)
  }, [query])

  const { data, isFetching } = useQuery({
    queryKey: ['mentions', 'contact', debounced],
    queryFn: () =>
      api.get<MentionSuggestion[]>(
        `/api/search/mentions?type=contact&q=${encodeURIComponent(debounced)}`,
      ),
    enabled: open,
    staleTime: 30_000,
  })

  const selected = new Set(value.map((v) => v.id))
  const results = (data ?? []).filter((r) => !selected.has(r.id))

  const [source, setSource] = React.useState({ debounced, open })
  if (source.debounced !== debounced || source.open !== open) {
    setSource({ debounced, open })
    setActive(0)
  }

  // Clicking away closes the menu; the picker sits inside a dialog that already
  // traps focus, so a pointerdown listener is enough.
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const add = (r: MentionSuggestion) => {
    if (selected.has(r.id)) return
    // Suggestions carry no avatar; the chip shows initials until the record reloads.
    onChange([...value, { id: r.id, displayName: r.label, avatarUrl: null }])
    setQuery('')
    setDebounced('')
    inputRef.current?.focus()
  }

  const remove = (id: string) => onChange(value.filter((v) => v.id !== id))

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !query && value.length) return remove(value[value.length - 1].id)
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true)
        e.preventDefault()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[active]) add(results[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <div
        onClick={() => {
          setOpen(true)
          inputRef.current?.focus()
        }}
        className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] p-1.5"
      >
        {value.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] py-0.5 pl-0.5 pr-1.5 text-xs text-[var(--accent-foreground)]"
          >
            <Avatar src={c.avatarUrl} name={c.displayName} size={18} />
            {c.displayName}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                remove(c.id)
              }}
              className="opacity-60 transition hover:opacity-100"
              aria-label={`Remove ${c.displayName}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <div className="flex min-w-32 flex-1 items-center gap-1.5 px-1">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            // A bare magnifier next to existing chips reads as decoration; the
            // short form keeps the field obviously typeable once it has content.
            placeholder={value.length ? 'Add…' : placeholder}
            className="w-full bg-transparent py-0.5 text-sm outline-none placeholder:text-[var(--muted-foreground)]"
          />
          {isFetching && (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--muted-foreground)]" />
          )}
        </div>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg">
          {results.length === 0 && (
            <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
              {isFetching
                ? 'Searching…'
                : query
                  ? `No one matching “${query}”`
                  : (emptyHint ?? 'No contacts yet')}
            </p>
          )}
          {results.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => add(r)}
              className={cn(
                'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors',
                i === active ? 'bg-[var(--muted)]' : 'hover:bg-[var(--muted)]',
              )}
            >
              <Avatar src={null} name={r.label} size={22} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{r.label}</span>
                {r.sublabel && (
                  <span className="block truncate text-[11px] text-[var(--muted-foreground)]">
                    {r.sublabel}
                  </span>
                )}
              </span>
              {r.isDraft && (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--pending)]">
                  draft
                </span>
              )}
            </button>
          ))}
          {!query && results.length > 0 && (
            <p className="border-t border-[var(--border)] px-3 pb-1 pt-1.5 text-[10px] text-[var(--muted-foreground)]">
              Most recently in touch · type to search all people
            </p>
          )}
        </div>
      )}
    </div>
  )
}
