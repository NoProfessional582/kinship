'use client'
/**
 * The draggable wrapper around an app's card.
 *
 * Deliberately empty of appearance. Kinship's original combined the sortable
 * wiring and the card's own face in one file; the face went back to Kinship and
 * only this wrapper is shared, because a card's contents are the most app-specific
 * thing on the board.
 */
import * as React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'

/**
 * `id` is the CARD id, not the item id: the same item can be rendered in two
 * swimlanes at once, and two draggables sharing an id break dnd-kit's registry.
 * See `cardId` in ./board.
 *
 * `disabled` turns off within-column reordering while a computed sort is active.
 * The card must STILL be draggable between columns — that sets its
 * column, which is orthogonal to sort order.
 *
 * ⚠️ Hence the object form. `useSortable({ disabled: true })` disables the
 * draggable AND the droppable halves, which makes the card completely immovable
 * — so a board under a computed sort silently lost cross-column drag as well,
 * which is not what was asked for and is a worse behaviour than the one being
 * prevented. Disabling only the droppable half stops the card acting as a
 * reorder target while leaving it draggable; the column's own zone droppable is
 * what then receives the drop.
 */
export function SortableCard({
  id,
  zone,
  disabled,
  children,
}: {
  id: string
  zone: string
  disabled?: boolean
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { type: 'card', zone },
    disabled: { draggable: false, droppable: !!disabled },
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('touch-none', isDragging && 'opacity-40')}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  )
}
