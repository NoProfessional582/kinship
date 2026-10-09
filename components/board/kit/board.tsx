'use client'
/**
 * Generic Kanban board — mechanics only. The app supplies everything that
 * gives a column or card meaning; the kit reads no column property but `id`.
 *
 * Extracted from Kinship's `components/board/board.tsx`, which is the reference
 * implementation. What came across is the *framework*: drag physics, the
 * collision cascade, optimistic reordering, the column frame. What deliberately
 * did NOT come across is anything about what a column or a card MEANS.
 *
 * ⚠️ THE CENTRAL RULE: this file reads no column property but `id`.
 *
 * Kinship's columns are workflow lanes carrying a `wipLimit` and a `status`
 * several columns may share. The job tracker's are pipeline stages carrying a
 * per-user `color` and `sort_order`. Neither borrows the other's semantics, and
 * a shared component that knew about either would be wrong for the other. So the
 * app renders its own header through `renderColumnHeader` and its own cards
 * through `renderCard`; this file only positions them and moves them around.
 *
 * If you find yourself wanting `column.name` in here, you want
 * `renderColumnHeader` instead.
 *
 * ── Adapter surface ─────────────────────────────────────────────────────────
 *   columns             { id }[]                    — order is display order
 *   items               { id, columnId, position }[] — position is fractional
 *   groups              { id, label, color? }[]      — swimlanes; omit for one
 *   groupIdsOf(item)    which swimlanes an item appears in
 *   renderColumnHeader({ column, count, group })
 *   renderCard({ item, dragging })
 *   onMove(itemId, toColumnId, toIndex, { beforeId, afterId })
 *   sortable            whether within-column reordering is offered
 *   settling            true while a move is in flight or being re-read
 *
 * ── No canDrop hook, deliberately ───────────────────────────────────────────
 * Kinship's `wipLimit` is display-only: it computes an over-limit visual state
 * and renders an n/limit counter, but nothing blocks a drop. Had it gated drops,
 * this component would have needed a generic predicate. It does not, so the
 * abstraction stays smaller. Add one only when some app actually wants a drop
 * refused — not in anticipation.
 */
import * as React from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  useDroppable,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { cn } from '@/lib/utils'
import { SortableCard } from './sortable-card'

// ─── The types an app must satisfy ──────────────────────────────────────────
//
// Structurally minimal on purpose. An app's real column and item types will
// carry far more than this; they satisfy these by having the right fields, and
// the extra fields travel through untouched to the render props.

export interface BoardColumn {
  id: string
}

export interface BoardItem {
  id: string
  columnId: string
  /** Fractional index. See lib/fractional-index.ts. */
  position: number
}

export interface BoardGroup {
  id: string
  label: string
  color?: string | null
}

/** The single swimlane used when an app does not group. */
const UNGROUPED: BoardGroup = { id: '__all__', label: '' }
const UNGROUPED_LANES: BoardGroup[] = [UNGROUPED]

// ─── Zone and card identity ─────────────────────────────────────────────────

/** Zone id encodes both axes, so one drop can resolve column and swimlane together. */
const zoneId = (columnId: string, groupId: string) => `${columnId}::${groupId}`

const parseZone = (id: string) => {
  const [columnId, groupId] = id.split('::')
  return { columnId, groupId }
}

/**
 * Draggables are identified by CARD, not by item.
 *
 * Inherited from Kinship along with the bug that produced it: grouped by
 * assignee, a task with two assignees renders in two lanes, and keying both
 * `useSortable` calls by the task id registered the same draggable id twice
 * inside one DndContext. dnd-kit keeps one node per id, so the first card became
 * undraggable and collision measurement pointed at the other card's rectangle.
 *
 * The id is minted once from the card's home zone and then MOVED between zones
 * as a string — never regenerated mid-drag — so `active.id` stays valid for the
 * life of the drag even as the card crosses lanes.
 *
 * ⚠️ This is why item ids must not contain '::'.
 */
const cardId = (zone: string, itemId: string) => `${zone}::${itemId}`

const parseCardId = (id: string) => {
  const [columnId, groupId, itemId] = id.split('::')
  return { columnId, groupId, itemId, zone: zoneId(columnId, groupId) }
}

type ZoneMap = Record<string, string[]>

/**
 * Snap to whatever the CURSOR is over, not to whatever the dragged card overlaps.
 *
 * `closestCorners` alone compares the dragged card's rectangle against each
 * column, so a card has to be hauled well past the boundary before the
 * neighbouring column wins — it feels like the card is being pulled back to
 * where it came from. Resolving the pointer first means the column takes over
 * the moment the cursor crosses into it.
 *
 * Each fallback earns its place: `rectIntersection` catches the cursor sitting
 * between two droppables while the card still overlaps one, and `closestCorners`
 * catches the cursor being outside every droppable entirely, so a drag never
 * ends with no target at all.
 */
const snapToCursor: CollisionDetection = (args) => {
  const byPointer = pointerWithin(args)
  if (byPointer.length > 0) return byPointer
  const byOverlap = rectIntersection(args)
  if (byOverlap.length > 0) return byOverlap
  return closestCorners(args)
}

export interface BoardProps<C extends BoardColumn, I extends BoardItem> {
  columns: C[]
  items: I[]
  groups?: BoardGroup[]
  /** Which swimlanes an item appears in. Defaults to the single ungrouped lane. */
  groupIdsOf?: (item: I) => string[]
  renderColumnHeader: (ctx: { column: C; count: number; group: BoardGroup }) => React.ReactNode
  renderCard: (ctx: { item: I; dragging?: boolean }) => React.ReactNode
  onMove: (
    itemId: string,
    toColumnId: string,
    toIndex: number,
    /**
     * The items either side of the drop slot, in the lane the card was dropped
     * into. The consumer needs these because `toIndex` counts only what this
     * board rendered: a filtered or grouped board's index means nothing to a
     * server ordering the whole column.
     */
    neighbours: { beforeId: string | null; afterId: string | null },
  ) => void
  /**
   * Within-column reordering. When false a card can still be dragged
   * BETWEEN columns — that sets columnId, which is orthogonal to sort order —
   * but not reordered inside one, because manual order is meaningless while a
   * computed sort is active. The alternative behaviours were both rejected:
   * silently switching the sort to Manual is a click with a large invisible
   * side effect, and letting the drag animate then snap back is worse.
   */
  sortable?: boolean
  /**
   * True while a move is in flight or its refetch is outstanding. The board
   * holds its local order until this clears — see the effect below, which is
   * the single subtlest thing in this file.
   */
  settling?: boolean
  /** Rendered inside an empty column. */
  emptyLabel?: string
  className?: string
}

export function Board<C extends BoardColumn, I extends BoardItem>({
  columns,
  items,
  groups,
  groupIdsOf,
  renderColumnHeader,
  renderCard,
  onMove,
  sortable = true,
  settling = false,
  emptyLabel = 'Drop a card here',
  className,
}: BoardProps<C, I>) {
  const [activeId, setActiveId] = React.useState<string | null>(null)

  // ⚠️ The fallback must be a constant, never a fresh `[UNGROUPED]`. `lanes` is
  // a dependency of `serverZones`, which the effect below copies into state: a
  // new array on every render made each render recompute the zones and set
  // them again — an endless render loop (~1,300 commits/s) that pinned a CPU
  // core and froze the page. It started on the first re-render after mount
  // (opening the new-task dialog was enough) whenever the board was ungrouped.
  const lanes = groups && groups.length > 0 ? groups : UNGROUPED_LANES
  const grouped = groups != null && groups.length > 0

  const byId = React.useMemo(
    () => Object.fromEntries(items.map((i) => [i.id, i])) as Record<string, I>,
    [items],
  )

  /**
   * Ordered card ids per zone, from the server's `position` values.
   *
   * Holding ORDER in state — not merely which column a card belongs to — is what
   * lets a drag reorder within a column and show it immediately, rather than
   * only snapping once the server responds.
   */
  const serverZones = React.useMemo<ZoneMap>(() => {
    const lanesOf = (item: I): string[] => (groupIdsOf ? groupIdsOf(item) : [UNGROUPED.id])

    const map: ZoneMap = {}
    for (const c of columns) for (const g of lanes) map[zoneId(c.id, g.id)] = []
    for (const item of [...items].sort((a, b) => a.position - b.position)) {
      for (const g of lanesOf(item)) {
        const z = zoneId(item.columnId, g)
        if (map[z]) map[z].push(cardId(z, item.id))
      }
    }
    return map
  }, [columns, lanes, items, groupIdsOf])

  const [zones, setZones] = React.useState<ZoneMap>(serverZones)

  /**
   * Local order wins from the moment a drag starts until the server has both
   * accepted the move and been re-read.
   *
   * Without the guard there is a window right after the drop — `activeId`
   * already cleared, the mutation not yet applied — where this effect sees the
   * PRE-MOVE server order and resets the board to it. The card lands, snaps
   * back, then jumps forward again once the response arrives, which reads as a
   * ghost returning to the old position.
   *
   * `settling` is the caller's half of this: it must stay true until the query
   * behind `items` has actually been re-read, not merely until the mutation
   * resolved. Getting that wrong reintroduces the snap-back, and it is the one
   * thing an app adopting this board most easily gets wrong.
   */
  React.useEffect(() => {
    if (!activeId && !settling) setZones(serverZones)
  }, [serverZones, activeId, settling])

  const sensors = useSensors(
    // 5px of travel before a drag starts, so a plain click still reaches the
    // card and opens it.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const zoneOf = (map: ZoneMap, card: string) => Object.keys(map).find((z) => map[z].includes(card))

  const resolveZone = (over: any): string | null => {
    if (!over) return null
    if (over.data.current?.type === 'zone') return String(over.id)
    return over.data.current?.zone ?? null
  }

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))

  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e
    const overZone = resolveZone(over)
    if (!overZone) return
    const id = String(active.id)

    // A card stays in the swimlane it belongs to; a drag only ever changes its
    // column. Its lane is a fact about the item — who it is assigned to, which
    // project it is in — and a drop is far too easy to do by accident to let it
    // rewrite one. Bailing here rather than at the drop is what stops the card
    // following the cursor into a lane it cannot land in.
    if (parseZone(overZone).groupId !== parseCardId(id).groupId) return

    setZones((prev) => {
      const from = zoneOf(prev, id)
      if (!from) return prev

      const overId = String(over!.id)
      const overIsCard = over!.data.current?.type === 'card'

      if (from === overZone) {
        // Reorder inside one column, live — but only when the app allows it.
        if (!sortable) return prev
        if (!overIsCard || overId === id) return prev
        const list = prev[from]
        const oldIndex = list.indexOf(id)
        const newIndex = list.indexOf(overId)
        if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return prev
        return { ...prev, [from]: arrayMove(list, oldIndex, newIndex) }
      }

      // Cross-column: drop at the hovered card's slot, else append. Always
      // allowed, even when `sortable` is false — this sets columnId, which is
      // orthogonal to sort order.
      const target = prev[overZone] ?? []
      const insertAt = overIsCard ? Math.max(0, target.indexOf(overId)) : target.length
      const next = [...target]
      next.splice(insertAt, 0, id)
      return { ...prev, [from]: prev[from].filter((x) => x !== id), [overZone]: next }
    })
  }

  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id)
    setActiveId(null)

    const finalZone = zoneOf(zones, id)
    if (!finalZone) {
      setZones(serverZones)
      return
    }

    const { columnId } = parseZone(finalZone)
    const lane = zones[finalZone]
    const toIndex = lane.indexOf(id)
    const { itemId } = parseCardId(id)

    // Stable ids for the slot the card landed in, read off the lane as the user
    // sees it. An index is only meaningful against the list it was counted in;
    // these survive the trip to a server that is looking at a different list.
    const neighbours = {
      beforeId: toIndex > 0 ? parseCardId(lane[toIndex - 1]).itemId : null,
      afterId: toIndex < lane.length - 1 ? parseCardId(lane[toIndex + 1]).itemId : null,
    }
    const original = byId[itemId]

    // Nothing moved: same column, same slot. Skipping the write here is not an
    // optimisation — it stops a click-with-a-twitch from writing a row and
    // invalidating the query for no change.
    const sameColumn = original?.columnId === columnId
    if (sameColumn && serverZones[finalZone]?.indexOf(id) === toIndex) return

    // Column and order only. The lane cannot have changed — onDragOver never
    // lets a card cross one — so there is nothing else to write.
    onMove(itemId, columnId, toIndex, neighbours)
  }

  const activeItem = activeId ? byId[parseCardId(activeId).itemId] : null
  /** The lane the in-flight drag started in; every other lane refuses the drop. */
  const activeGroupId = activeId ? parseCardId(activeId).groupId : null
  const fullHeight = !grouped

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={snapToCursor}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null)
        setZones(serverZones)
      }}
    >
      <div className={cn('flex flex-col gap-6', fullHeight && 'h-full', className)}>
        {lanes.map((group) => (
          <section key={group.id} className={cn('flex min-h-0 flex-col', fullHeight && 'h-full')}>
            {grouped && (
              <div className="mb-2 flex items-center gap-2">
                {group.color && (
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: group.color }} />
                )}
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  {group.label}
                </h3>
                <span className="h-px flex-1 bg-[var(--border)]" />
              </div>
            )}
            <div
              className={cn(
                'flex min-h-0 flex-1 gap-4 overflow-x-auto pb-1 [justify-content:safe_center]',
                !fullHeight && 'items-start',
              )}
            >
              {columns.map((column) => {
                const z = zoneId(column.id, group.id)
                const cardIds = zones[z] ?? []
                return (
                  <Column
                    key={column.id}
                    zone={z}
                    cardIds={cardIds}
                    fullHeight={fullHeight}
                    dropDisabled={activeGroupId !== null && activeGroupId !== group.id}
                    header={renderColumnHeader({ column, count: cardIds.length, group })}
                    emptyLabel={emptyLabel}
                  >
                    {cardIds.map((cid) => {
                      const item = byId[parseCardId(cid).itemId]
                      return item ? (
                        <SortableCard key={cid} id={cid} zone={z} disabled={!sortable}>
                          {renderCard({ item })}
                        </SortableCard>
                      ) : null
                    })}
                  </Column>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeItem && (
          <div className="w-[19rem] rotate-2">
            {renderCard({ item: activeItem, dragging: true })}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

/**
 * The column frame: scroll, drop affordance, and nothing about meaning.
 *
 * Its header is a rendered node handed down from the app, not a set of props
 * describing a column — the mechanics/meaning boundary, made structural. A future
 * edit that needs a column field in here should change the app's
 * `renderColumnHeader` instead.
 */
function Column({
  zone,
  cardIds,
  fullHeight,
  dropDisabled,
  header,
  emptyLabel,
  children,
}: {
  zone: string
  cardIds: string[]
  fullHeight: boolean
  dropDisabled: boolean
  header: React.ReactNode
  emptyLabel: string
  children: React.ReactNode
}) {
  // Disabled rather than merely ignored: dnd-kit leaves disabled droppables out
  // of collision detection entirely, so a column in another lane never lights up
  // as a target it would then refuse.
  const { setNodeRef, isOver } = useDroppable({
    id: zone,
    data: { type: 'zone' },
    disabled: dropDisabled,
  })

  return (
    // The droppable covers the whole column, header included, so the cursor only
    // has to enter the column — not reach the list — for it to take over.
    //
    // Columns share out the page measure rather than taking a fixed width.
    // Fixed-width columns left the board clumped against the left edge of an
    // otherwise centred page; growing into the measure keeps the first column
    // under the page heading and the last under the primary action at every width.
    //
    // `shrink-0` with a basis floor rather than `flex-1`: below the floor the
    // columns must overflow and scroll, not squeeze into unreadable cards.
    <div
      ref={setNodeRef}
      data-zone={zone}
      className={cn(
        'flex shrink-0 grow basis-[16.5rem] flex-col',
        'min-w-[16.5rem] max-w-[26rem]',
        fullHeight ? 'h-full' : 'max-h-full',
      )}
    >
      <div className="mb-2 px-1">{header}</div>

      <div
        className={cn(
          'flex min-h-[7rem] flex-1 flex-col gap-2.5 overflow-y-auto rounded-[var(--radius)] border p-2.5 transition-colors',
          isOver
            ? 'border-[var(--primary)] bg-[color-mix(in_oklch,var(--primary)_8%,transparent)]'
            : 'border-transparent bg-[color-mix(in_oklch,var(--muted)_70%,transparent)]',
        )}
      >
        <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
          {children}
        </SortableContext>
        {cardIds.length === 0 && (
          <p className="px-1 py-6 text-center text-xs text-[var(--muted-foreground)] opacity-60">
            {emptyLabel}
          </p>
        )}
      </div>
    </div>
  )
}
