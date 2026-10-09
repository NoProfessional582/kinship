'use client'
import * as React from 'react'
import { useIsFetching } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { Board as BoardKit, type BoardGroup } from './kit/board'
import { TaskCardFace } from './task-card'
import { keys, useMoveTask } from '@/lib/hooks/api'

/**
 * Kinship's board, on the generic board kit in `./kit` (mechanics only; see
 * `./kit/board.tsx`).
 *
 * Everything that used to be in this file and is now in `./kit/board` was
 * *mechanics*: the DndContext, the pointerWithin → rectIntersection →
 * closestCorners cascade, the card-vs-task id encoding, the optimistic ZoneMap,
 * the DragOverlay. Everything that stayed is *meaning* — what a column is, what
 * a swimlane is, what a card looks like, and how a move is persisted.
 *
 * ⚠️ Kinship is the reference implementation, so this refactor is the test of the
 * abstraction rather than a beneficiary of it. If the kit could not serve
 * this file, the kit would be wrong. It served it; what follows is what had to
 * be handed across, and each one is a prop rather than a special case inside the
 * shared component.
 *
 * The kit reads no column property but `id`. `wipLimit`, `color` and `name` are
 * rendered by `renderColumnHeader` below and never leave this file.
 */

export type GroupBy = 'none' | 'project' | 'assignee'

const UNGROUPED: BoardGroup = { id: '__none__', label: 'No project' }

export function Board({
  columns,
  tasks,
  projectId,
  groupBy,
  onOpenTask,
}: {
  columns: any[]
  tasks: any[]
  projectId: string | null
  groupBy: GroupBy
  onOpenTask?: (task: any) => void
}) {
  const move = useMoveTask(projectId)

  /** Moves dropped but not yet confirmed. */
  const [inFlight, setInFlight] = React.useState(0)
  /** Non-zero while the board query is refetching after an invalidation. */
  const refetching = useIsFetching({ queryKey: keys.board(projectId) })

  /**
   * ⚠️ Two conditions, not one, and this is the kit's one subtle contract.
   *
   * The counter closes the synchronous window right after a drop — activeId
   * cleared, mutation not yet applied — where the board would otherwise see the
   * PRE-MOVE server order and reset to it. `refetching` then holds the guard
   * open until the invalidated query has actually been re-read, without
   * depending on the order in which react-query fires per-call mutation
   * callbacks. Drop either half and the card lands, snaps back, and jumps
   * forward again when the response arrives.
   */
  const settling = inFlight > 0 || refetching > 0

  const groups = React.useMemo<BoardGroup[] | undefined>(() => {
    if (groupBy === 'project') {
      const seen = new Map<string, BoardGroup>()
      for (const t of tasks) {
        if (t.project)
          seen.set(t.project.id, {
            id: t.project.id,
            label: t.project.name,
            color: t.project.color,
          })
      }
      return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label)).concat(UNGROUPED)
    }
    if (groupBy === 'assignee') {
      const seen = new Map<string, BoardGroup>()
      for (const t of tasks) {
        for (const a of t.assignees ?? [])
          seen.set(a.contact.id, { id: a.contact.id, label: a.contact.displayName })
      }
      return [...seen.values()]
        .sort((a, b) => a.label.localeCompare(b.label))
        .concat({ id: '__none__', label: 'Unassigned' })
    }
    // undefined rather than a one-element array: the kit reads that as "not
    // grouped" and drops the lane headings and the per-lane sections entirely.
    return undefined
  }, [groupBy, tasks])

  /**
   * Which lanes a task appears in. A task with two assignees really is rendered
   * twice under `assignee` grouping — that is why the kit keys draggables by
   * card rather than by item.
   */
  const groupIdsOf = React.useCallback(
    (task: any): string[] => {
      if (groupBy === 'project') return [task.project?.id ?? '__none__']
      if (groupBy === 'assignee') {
        const ids = (task.assignees ?? []).map((a: any) => a.contact.id)
        return ids.length ? ids : ['__none__']
      }
      return ['__all__']
    },
    [groupBy],
  )

  const onMove = React.useCallback(
    (
      taskId: string,
      columnId: string,
      toIndex: number,
      neighbours: { beforeId: string | null; afterId: string | null },
    ) => {
      setInFlight((n) => n + 1)
      move.mutate(
        { taskId, columnId, toIndex, ...neighbours },
        {
          // Runs after the mutation's own onSettled has finished invalidating, so by
          // now the server order reflects the move and is safe to adopt.
          onSettled: () => setInFlight((n) => Math.max(0, n - 1)),
        },
      )
    },
    [move],
  )

  return (
    <BoardKit<any, any>
      columns={columns}
      items={tasks}
      groups={groups}
      groupIdsOf={groupIdsOf}
      onMove={onMove}
      settling={settling}
      renderColumnHeader={({ column, count }) => {
        // Kinship's own column semantics, and the reason the kit refuses to know
        // about them: `wipLimit` is DISPLAY-ONLY here. It colours the counter and
        // nothing more — no drop is ever blocked — which is why the kit needs no
        // canDrop predicate.
        const overLimit = column.wipLimit != null && count > column.wipLimit
        const accent = column.color ?? 'var(--primary)'
        return (
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: accent }} />
            <h4 className="flex-1 truncate text-sm font-semibold">{column.name}</h4>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-medium',
                overLimit ? 'bg-[var(--destructive)] text-white' : 'text-[var(--muted-foreground)]',
              )}
              style={
                overLimit
                  ? undefined
                  : { background: `color-mix(in oklch, ${accent} 14%, transparent)` }
              }
            >
              {count}
              {column.wipLimit != null ? `/${column.wipLimit}` : ''}
            </span>
          </div>
        )
      }}
      renderCard={({ item, dragging }) => (
        <TaskCardFace task={item} dragging={dragging} onOpen={dragging ? undefined : onOpenTask} />
      )}
    />
  )
}
