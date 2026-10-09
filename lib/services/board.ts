import { prisma } from '../db'
import type { TaskStatus } from '@prisma/client'
import { ConflictError } from '../errors'
import { STEP, needsRenormalize, renormalizedPositions } from '../fractional-index'

type Tx = Omit<
  typeof prisma,
  '$transaction' | '$connect' | '$disconnect' | '$on' | '$use' | '$extends'
>

export const DEFAULT_COLUMNS = [
  { name: 'Backlog', color: '#64748b', status: 'TODO' as const },
  { name: 'To Do', color: '#3b82f6', status: 'TODO' as const },
  { name: 'In Progress', color: '#f59e0b', status: 'IN_PROGRESS' as const },
  { name: 'Blocked', color: '#ef4444', status: 'BLOCKED' as const },
  { name: 'Done', color: '#22c55e', status: 'DONE' as const },
]

/**
 * There is exactly one board. A project view is that board filtered down to the
 * project's cards, not a board of its own.
 *
 * Per-project column sets were the alternative, and they quietly broke the
 * project page: a task tagged into a project still sat in a global column, so
 * opening the project created a fresh empty set of columns and reported "no
 * tasks in this project yet" about cards the board was showing at the time.
 * (`BoardColumn.projectId` survives in the schema, unused, so this needs no
 * migration; every column is written with it null.)
 */
export async function ensureColumns(tx: Tx, owner: string) {
  const existing = await tx.boardColumn.findMany({
    where: { owner, projectId: null },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  })
  if (existing.length > 0) return existing

  await tx.boardColumn.createMany({
    data: DEFAULT_COLUMNS.map((c, i) => ({
      ...c,
      owner,
      projectId: null,
      position: (i + 1) * STEP,
    })),
  })
  return tx.boardColumn.findMany({
    where: { owner, projectId: null },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  })
}

/** The column an inline-created task lands in: the first one on the board. */
export async function defaultColumnId(tx: Tx, owner: string): Promise<string> {
  const columns = await ensureColumns(tx, owner)
  return columns[0].id
}

/** Position that appends to the end of a column. */
export async function appendPosition(tx: Tx, owner: string, columnId: string): Promise<number> {
  const last = await tx.task.findFirst({
    where: { owner, columnId, deletedAt: null },
    orderBy: [{ position: 'desc' }, { id: 'desc' }],
    select: { position: true },
  })
  return last ? last.position + STEP : STEP
}

/**
 * Rewrites a column to evenly spaced positions once midpoint subdivision has
 * squeezed neighbours below the epsilon. Cheap and rare.
 */
export async function renormalizeColumn(tx: Tx, owner: string, columnId: string): Promise<void> {
  const tasks = await tx.task.findMany({
    where: { owner, columnId, deletedAt: null },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: { id: true, position: true },
  })
  if (!needsRenormalize(tasks.map((t) => t.position))) return

  const fresh = renormalizedPositions(tasks.length)
  await Promise.all(
    tasks.map((t, i) =>
      tx.task.updateMany({ where: { id: t.id, owner }, data: { position: fresh[i] } }),
    ),
  )
}

/**
 * A card's status is whatever column it sits in, so changing the column's
 * status has to carry its cards with it. Without this the board and the
 * calendar disagree the moment a column is renamed from "Done" to something
 * else: the cards keep a DONE they are no longer sitting in.
 *
 * Soft-deleted cards are included deliberately — one restored from the trash
 * later must not come back carrying a status its column stopped conferring.
 */
export async function updateColumn(
  owner: string,
  id: string,
  patch: { name?: string; color?: string | null; wipLimit?: number | null; status?: TaskStatus },
) {
  return prisma.$transaction(async (tx) => {
    await tx.boardColumn.findFirstOrThrow({ where: { id, owner }, select: { id: true } })
    const column = await tx.boardColumn.update({ where: { id }, data: patch })

    if (patch.status !== undefined) {
      if (patch.status === 'DONE') {
        // Only cards without a completion instant get one; the rest keep theirs.
        await tx.task.updateMany({
          where: { owner, columnId: id, completedAt: null },
          data: { status: 'DONE', completedAt: new Date() },
        })
        await tx.task.updateMany({
          where: { owner, columnId: id, NOT: { completedAt: null } },
          data: { status: 'DONE' },
        })
      } else {
        await tx.task.updateMany({
          where: { owner, columnId: id },
          data: { status: patch.status, completedAt: null },
        })
      }
    }

    return column
  })
}

/**
 * Task.column cascades, so deleting a column takes every card in it with it —
 * permanently, straight past the trash. The UI has always said cards must be
 * moved out first; this is what makes that true rather than a hope.
 *
 * Cards already in the trash count: they are recoverable until the trash is
 * emptied, and a cascade would quietly end that.
 */
export async function deleteColumn(owner: string, id: string) {
  await prisma.boardColumn.findFirstOrThrow({ where: { id, owner }, select: { id: true } })
  const [live, trashed] = await Promise.all([
    prisma.task.count({ where: { owner, columnId: id, deletedAt: null } }),
    prisma.task.count({ where: { owner, columnId: id, NOT: { deletedAt: null } } }),
  ])

  if (live > 0) {
    throw new ConflictError(
      `Move the ${live} card${live === 1 ? '' : 's'} out of this column before removing it.`,
    )
  }
  if (trashed > 0) {
    throw new ConflictError(
      `This column still holds ${trashed} deleted card${trashed === 1 ? '' : 's'}. ` +
        'Restore them or empty the trash first — removing the column would delete them for good.',
    )
  }

  return prisma.boardColumn.delete({ where: { id } })
}
