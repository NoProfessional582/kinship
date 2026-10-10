'use client'
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Command } from 'cmdk'
import { useQuery } from '@tanstack/react-query'
import {
  User,
  SquareCheck,
  FolderKanban,
  NotebookPen,
  KanbanSquare,
  CalendarDays,
  Users,
  Plus,
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/hooks/api'
import { m } from '@/lib/mobile/href'
import { useUi } from '@/lib/store'
import type { SearchHit } from '@/lib/services/search'

const ICONS = {
  entry: NotebookPen,
  contact: User,
  task: SquareCheck,
  project: FolderKanban,
} as const

const ACTIONS = [
  { label: 'New note', href: '/notes', icon: Plus },
  { label: 'Go to contacts', href: '/contacts', icon: Users },
  { label: 'Go to board', href: '/board', icon: KanbanSquare },
  { label: 'Go to calendar', href: '/calendar', icon: CalendarDays },
]

/**
 * Cmd+K search across every entity, backed by Postgres FTS and trigram.
 *
 * Results and actions carry desktop paths; `phone` (the mobile shell) opens the
 * matching page under /m instead, so a search never leaves the phone GUI.
 */
export function CommandPalette({ phone = false }: { phone?: boolean }) {
  const { paletteOpen, setPaletteOpen } = useUi()
  const [query, setQuery] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const router = useRouter()

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150)
    return () => clearTimeout(t)
  }, [query])

  const { data: hits, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<SearchHit[]>(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.trim().length > 0,
  })

  const go = (href: string) => {
    setPaletteOpen(false)
    setQuery('')
    router.push(phone ? m(href) : href)
  }

  return (
    <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogContent className="max-w-xl gap-0 p-0" hideClose>
        <DialogTitle className="sr-only">Search</DialogTitle>
        <Command shouldFilter={false} className="overflow-hidden">
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search people, notes, tasks and projects…"
            className="w-full border-b border-[var(--border)] bg-transparent px-4 py-3.5 text-sm outline-none placeholder:text-[var(--muted-foreground)]"
          />
          <Command.List className="max-h-80 overflow-y-auto p-2">
            {debounced && !isFetching && (hits ?? []).length === 0 && (
              <Command.Empty className="px-3 py-6 text-center text-sm text-[var(--muted-foreground)]">
                Nothing found for “{debounced}”
              </Command.Empty>
            )}

            {!debounced && (
              <Command.Group heading={<GroupLabel>Jump to</GroupLabel>}>
                {ACTIONS.map((a) => (
                  <Item key={a.href} onSelect={() => go(a.href)}>
                    <a.icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    <span className="flex-1">{a.label}</span>
                  </Item>
                ))}
              </Command.Group>
            )}

            {(hits ?? []).length > 0 && (
              <Command.Group heading={<GroupLabel>Results</GroupLabel>}>
                {(hits ?? []).map((hit) => {
                  const Icon = ICONS[hit.kind]
                  return (
                    <Item key={`${hit.kind}:${hit.id}`} onSelect={() => go(hit.href)}>
                      <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{hit.title}</span>
                        {hit.snippet && (
                          <span
                            className="block truncate text-[11px] text-[var(--muted-foreground)] [&_b]:text-[var(--primary)]"
                            dangerouslySetInnerHTML={{ __html: hit.snippet }}
                          />
                        )}
                      </span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                        {hit.kind}
                      </span>
                    </Item>
                  )
                })}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
      {children}
    </span>
  )
}

function Item({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm data-[selected=true]:bg-[var(--accent)] data-[selected=true]:text-[var(--accent-foreground)]"
    >
      {children}
    </Command.Item>
  )
}
