'use client'
import * as React from 'react'
import { Plus, User, SquareCheck, FolderKanban, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MentionSuggestion } from '@/lib/services/search'

export interface SuggestionItem extends MentionSuggestion {
  /** Present on the "create new" affordances at the bottom of the list. */
  createAs?: 'contact' | 'task' | 'project'
}

export interface SuggestionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

interface Props {
  items: SuggestionItem[]
  loading: boolean
  command: (item: SuggestionItem) => void
}

const ICONS = {
  contact: User,
  task: SquareCheck,
  project: FolderKanban,
} as const

/**
 * One dropdown serves both triggers. The create affordances are appended by the
 * extension, so this component only has to render whatever list it is handed.
 */
export const SuggestionList = React.forwardRef<SuggestionListHandle, Props>(
  ({ items, loading, command }, ref) => {
    const [selected, setSelected] = React.useState(0)
    const containerRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => setSelected(0), [items])

    React.useEffect(() => {
      const el = containerRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      el?.scrollIntoView({ block: 'nearest' })
    }, [selected])

    React.useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'ArrowUp') {
          setSelected((s) => (s + items.length - 1) % Math.max(1, items.length))
          return true
        }
        if (event.key === 'ArrowDown') {
          setSelected((s) => (s + 1) % Math.max(1, items.length))
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = items[selected]
          if (item) { command(item); return true }
          return false
        }
        return false
      },
    }), [items, selected, command])

    if (!loading && items.length === 0) return null

    const firstCreateIndex = items.findIndex((i) => i.createAs)

    return (
      <div
        ref={containerRef}
        className="max-h-72 w-80 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 shadow-xl"
      >
        {loading && items.length === 0 && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--muted-foreground)]">
            <Loader2 className="h-3 w-3 animate-spin" /> Searching…
          </div>
        )}

        {items.map((item, index) => {
          const Icon = ICONS[item.createAs ?? item.kind] ?? User
          const isCreate = Boolean(item.createAs)
          return (
            <React.Fragment key={`${item.kind}-${item.id}-${index}`}>
              {isCreate && index === firstCreateIndex && firstCreateIndex > 0 && (
                <div className="my-1 h-px bg-[var(--border)]" />
              )}
              <button
                type="button"
                data-index={index}
                onMouseEnter={() => setSelected(index)}
                onMouseDown={(e) => { e.preventDefault(); command(item) }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                  index === selected ? 'bg-[var(--accent)] text-[var(--accent-foreground)]' : 'hover:bg-[var(--muted)]',
                )}
              >
                {isCreate
                  ? <Plus className="h-3.5 w-3.5 shrink-0 text-[var(--pending)]" />
                  : <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />}
                <span className="min-w-0 flex-1 truncate">
                  {isCreate ? <>Create {item.createAs} <span className="font-medium">“{item.label}”</span></> : item.label}
                </span>
                {/* The cap is load-bearing. `shrink-0` here let a long role +
                    company string size the row past its own width, and the name
                    beside it is `flex-1` off a zero basis — so it collapsed to
                    0px and the person vanished, leaving only their headline.
                    Real job titles run past 120 characters; the demo data never
                    did, which is why this only surfaced once the LinkedIn
                    import landed. Capping the sublabel leaves the name the rest. */}
                {!isCreate && item.sublabel && (
                  <span className="min-w-0 max-w-[45%] truncate text-[11px] text-[var(--muted-foreground)]">
                    {item.sublabel}
                  </span>
                )}
              </button>
            </React.Fragment>
          )
        })}
      </div>
    )
  },
)
SuggestionList.displayName = 'SuggestionList'
