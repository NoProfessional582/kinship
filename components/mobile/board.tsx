'use client'
import * as React from 'react'
import { subscribeBrowser } from '@/lib/hooks/platform'
import { toast } from 'sonner'
import {
  ChevronDown,
  ChevronRight,
  MoveRight,
  Loader2,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react'
import { MEmpty, MTile } from '@/components/mobile/bits'
import { MSheet, MSheetContent, MSheetTitle, MSheetHeader } from '@/components/mobile/sheet'
import { useMoveTask } from '@/lib/hooks/api'
import { cn } from '@/lib/utils'

/** Which columns the phone last had shut. Survives a reload, and a tab switch. */
const COLLAPSED_KEY = 'kb.m.board.collapsed'

/**
 * The board on a phone: the columns stacked one over the other, each one a tile
 * that opens and shuts.
 *
 * The desktop board scrolls columns floored at `min-w-[16.5rem]`, which shows
 * one and a half of them on a 412px screen and loses the point of a board. The
 * first phone answer to that was a pager — one column at a time behind previous
 * and next arrows — and the problem with it is that a board is meant to be read
 * at a glance: four of the five columns were always off-screen, and finding out
 * whether anything was in review cost two taps and lost your place in Doing.
 *
 * Stacked, every column is on the page at once. Shutting one leaves its spine —
 * name, colour and count — so a column you are not working out of costs one row
 * instead of a screen, and the stack stays short enough to thumb through.
 *
 * Cards move by menu, not by drag. The desktop board configures dnd-kit with a
 * `PointerSensor` at `distance: 5` and a `KeyboardSensor`; on touch, a 5px
 * movement inside a scrolling column is indistinguishable from a scroll, so
 * drag-to-move and scroll-the-list fight each other and both feel broken.
 * Making the move explicit is more reliable than a long-press lift and much
 * easier to hit with a thumb. (If drag is ever wanted here, it needs a
 * TouchSensor with `{ delay: 250, tolerance: 5 }` and `touch-action: none` on a
 * dedicated handle — not the whole card.)
 */
function storedColumns() {
  try {
    return localStorage.getItem(COLLAPSED_KEY)
  } catch {
    return null
  }
}

export function MobileBoard({
  columns,
  tasks,
  projectId,
  onOpenTask,
}: {
  columns: any[]
  tasks: any[]
  projectId: string | null
  onOpenTask: (id: string) => void
}) {
  const raw = React.useSyncExternalStore(subscribeBrowser, storedColumns, () => null)
  const saved = React.useMemo(() => {
    try {
      return new Set(JSON.parse(raw ?? '[]') as string[])
    } catch {
      return new Set<string>()
    }
  }, [raw])
  const [choice, setCollapsed] = React.useState<Set<string> | null>(null)
  const collapsed = choice ?? saved
  const [moving, setMoving] = React.useState<any | null>(null)
  const move = useMoveTask(projectId)

  const persist = (next: Set<string>) => {
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
    } catch {
      /* not worth a toast */
    }
  }

  const toggle = (id: string) => {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    persist(next)
  }

  const byColumn = React.useMemo(() => {
    const out = new Map<string, any[]>()
    for (const c of columns) out.set(c.id, [])
    for (const t of tasks) out.get(t.columnId)?.push(t)
    return out
  }, [columns, tasks])

  if (!columns.length) return <MEmpty>No columns yet.</MEmpty>

  // Only ever "collapse all" while something is open, so the control is never a
  // no-op: the one-tap way back to a readable board.
  const allShut = columns.every((c) => collapsed.has(c.id))

  const commit = async (task: any, toColumnId: string) => {
    setMoving(null)
    try {
      // toIndex 0: dropped at the top of the target column. The server owns the
      // fractional index, and the desktop board deliberately does not recompute
      // ordering client-side either.
      await move.mutateAsync({ taskId: task.id, columnId: toColumnId, toIndex: 0 })
      const to = columns.find((c) => c.id === toColumnId)
      toast.success(`Moved to ${to?.name ?? 'column'}`)
      // Moving a card into a shut column and watching nothing happen reads as a
      // failed move, so the destination opens itself.
      if (to && collapsed.has(to.id)) {
        const next = new Set(collapsed)
        next.delete(to.id)
        persist(next)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-[var(--muted-foreground)]">
          {columns.length} columns · {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
        </p>
        <button
          onClick={() => persist(allShut ? new Set() : new Set(columns.map((c) => c.id)))}
          className="kb-tap-inline gap-1.5 text-[11px] text-[var(--muted-foreground)]"
        >
          {allShut ? (
            <ChevronsUpDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronsDownUp className="h-3.5 w-3.5" />
          )}
          {allShut ? 'Expand all' : 'Collapse all'}
        </button>
      </div>

      {columns.map((col) => {
        const inColumn = byColumn.get(col.id) ?? []
        const shut = collapsed.has(col.id)
        return (
          // The spine: a column's colour on the edge of its own tile, so a shut
          // column is still identifiable by shape rather than only by name.
          <MTile
            key={col.id}
            className="border-l-[3px] px-0 py-0"
            style={{ borderLeftColor: col.color ?? 'var(--border)' }}
          >
            <button
              onClick={() => toggle(col.id)}
              aria-expanded={!shut}
              className="kb-tap flex w-full items-center gap-2 px-3 text-left"
            >
              {shut ? (
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{col.name}</span>
              <span className="shrink-0 rounded-full bg-[var(--muted)] px-2 py-0.5 font-mono text-[11px] text-[var(--muted-foreground)]">
                {inColumn.length}
              </span>
            </button>

            {!shut && (
              <div className="border-t border-[var(--border)] px-2 py-2">
                {inColumn.length === 0 ? (
                  <p className="px-1 py-1 text-[13px] text-[var(--muted-foreground)] opacity-80">
                    Nothing in {col.name}.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {inColumn.map((t) => (
                      <li key={t.id} className="flex items-stretch gap-2">
                        <button
                          onClick={() => onOpenTask(t.id)}
                          className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] p-3 text-left"
                        >
                          <p
                            className={cn(
                              'truncate text-sm',
                              t.status === 'DONE' && 'line-through opacity-60',
                            )}
                          >
                            {t.title}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--muted-foreground)]">
                            {t.project && (
                              <span className="flex items-center gap-1">
                                <span
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{ background: t.project.color ?? 'var(--primary)' }}
                                />
                                {t.project.name}
                              </span>
                            )}
                            {t.priority && t.priority !== 'NONE' && (
                              <span>{String(t.priority).toLowerCase()}</span>
                            )}
                            {(t.assignees?.length ?? 0) > 0 && (
                              <span className="truncate">
                                {t.assignees
                                  .map((a: any) => a.contact?.displayName)
                                  .filter(Boolean)
                                  .join(', ')}
                              </span>
                            )}
                          </div>
                        </button>
                        <button
                          onClick={() => setMoving(t)}
                          aria-label={`Move ${t.title}`}
                          className="kb-tap flex shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--muted-foreground)]"
                        >
                          {move.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MoveRight className="h-4 w-4" />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </MTile>
        )
      })}

      <MSheet
        open={Boolean(moving)}
        onOpenChange={(o) => {
          if (!o) setMoving(null)
        }}
      >
        <MSheetContent hideClose>
          <MSheetHeader>
            <MSheetTitle className="truncate text-sm font-semibold">
              Move “{moving?.title}”
            </MSheetTitle>
          </MSheetHeader>
          <div className="flex flex-col px-2 pb-3">
            {columns.map((col) => (
              <button
                key={col.id}
                disabled={col.id === moving?.columnId}
                onClick={() => commit(moving, col.id)}
                className="kb-tap flex items-center gap-2 rounded-[var(--radius-md)] px-3 text-left text-sm disabled:opacity-40"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: col.color ?? 'var(--muted-foreground)' }}
                />
                {col.name}
                {col.id === moving?.columnId && (
                  <span className="text-[11px] text-[var(--muted-foreground)]">(current)</span>
                )}
              </button>
            ))}
          </div>
        </MSheetContent>
      </MSheet>
    </div>
  )
}
