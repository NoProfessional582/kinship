import { prisma, type Tx } from '../db'
import { uniqueSlug } from '../slug'
import { positionBetween, positionForIndex } from '../fractional-index'
import type { UpsertTaskInput } from '../validation'
import { appendPosition, defaultColumnId, ensureColumns, renormalizeColumn } from './board'
import type { Prisma, TaskStatus } from '@prisma/client'
import { resolveTagIds } from './tags'
import { softDelete } from './trash'
import { ownerTransaction } from '../owner-lock'
import { ValidationError } from '../errors'
import { taskCycles } from '../task-hierarchy'

// Position, then id, like the board: two subtasks at one position always come
// back in the same order. Typed outside `taskDetail`, whose `as const` would
// make the list read-only, which Prisma does not accept.
const subtaskOrder: Prisma.TaskOrderByWithRelationInput[] = [{ position: 'asc' }, { id: 'asc' }]

export const taskDetail = {
  project: { select: { id: true, slug: true, name: true, color: true } },
  column: true,
  assignees: {
    include: { contact: { select: { id: true, slug: true, displayName: true, avatarUrl: true } } },
  },
  tags: { include: { tag: true } },
  subtasks: {
    // K06: without this filter a soft-deleted child stayed visible inside its
    // parent's detail — and in the count below — while `getTask(child)` hid it,
    // so the same row was both deleted and not deleted depending on how you
    // looked at it. Trash still holds it, and restoring still brings it back.
    where: { deletedAt: null },
    select: { id: true, slug: true, title: true, status: true, dueDate: true, priority: true },
    orderBy: subtaskOrder,
  },
  _count: { select: { subtasks: { where: { deletedAt: null } }, refs: true } },
} as const

/**
 * A task's status is whatever its column says. Keeping the two in sync in one
 * place means a card can never show a status that contradicts the column it is
 * sitting in — which is what made the old separate Status field so confusing.
 */
async function statusForColumn(tx: Tx, owner: string, columnId: string): Promise<TaskStatus> {
  const column = await tx.boardColumn.findFirstOrThrow({
    where: { id: columnId, owner },
    select: { status: true },
  })
  return column.status as TaskStatus
}

async function validateLinks(tx: Tx, owner: string, input: UpsertTaskInput) {
  if (input.projectId)
    await tx.project.findFirstOrThrow({
      where: { id: input.projectId, owner },
      select: { id: true },
    })
  if (input.parentTaskId)
    await tx.task.findFirstOrThrow({
      where: { id: input.parentTaskId, owner },
      select: { id: true },
    })
  if (input.assigneeIds.length) {
    const count = await tx.contact.count({ where: { owner, id: { in: input.assigneeIds } } })
    if (count !== new Set(input.assigneeIds).size)
      throw Object.assign(new Error('Not found'), { code: 'P2025' })
  }
}

const completionFor = (status: TaskStatus, existing?: Date | null) =>
  status === 'DONE' ? (existing ?? new Date()) : null

/**
 * The board, optionally narrowed to one project. The columns are the same set
 * either way — a project scopes which *cards* are returned, never which
 * columns exist — so a card is in the same column wherever you look at it.
 */
export async function getBoard(owner: string, projectId: string | null) {
  if (projectId)
    await prisma.project.findFirstOrThrow({ where: { id: projectId, owner }, select: { id: true } })
  const columns = await ensureColumns(prisma, owner)
  const tasks = await prisma.task.findMany({
    where: {
      owner,
      deletedAt: null,
      columnId: { in: columns.map((c) => c.id) },
      parentTaskId: null, // subtasks render inside their parent card, not as columns entries
      ...(projectId ? { projectId } : {}),
    },
    include: taskDetail,
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  })
  return { columns, tasks }
}

export async function getTask(owner: string, idOrSlug: string) {
  return prisma.task.findFirst({
    where: { owner, AND: [{ deletedAt: null }, { OR: [{ id: idOrSlug }, { slug: idOrSlug }] }] },
    include: { ...taskDetail, parent: { select: { id: true, slug: true, title: true } } },
  })
}

/** Includes trashed ancestors: restoring them must not expose a new cycle. */
async function validateParent(tx: Tx, owner: string, id: string | null, parentId?: string | null) {
  const seen = new Set<string>()
  let current = parentId
  while (current) {
    if (current === id || seen.has(current)) {
      throw new ValidationError('Task parents must not form a cycle.')
    }
    seen.add(current)
    const parent = await tx.task.findFirstOrThrow({
      where: { id: current, owner },
      select: { parentTaskId: true },
    })
    current = parent.parentTaskId
  }
}

/** Read-only inventory, including trash. Never edits existing task links. */
export async function taskHierarchyReport(owner: string) {
  const rows = await prisma.task.findMany({
    where: { owner },
    select: { id: true, parentTaskId: true, deletedAt: true },
    orderBy: { id: 'asc' },
  })
  const cycles = taskCycles(rows)
  const affected = new Set(cycles.flat())
  return { cycles, tasks: rows.filter((r) => affected.has(r.id)) }
}

export async function createTask(owner: string, input: UpsertTaskInput) {
  return ownerTransaction(owner, async (tx) => {
    await validateParent(tx, owner, null, input.parentTaskId)
    await validateLinks(tx, owner, input)
    const slug = await uniqueSlug('task', owner, input.title, tx)
    const columnId = input.columnId ?? (await defaultColumnId(tx, owner))
    const position = await appendPosition(tx, owner, columnId)
    const tagIds = await resolveTagIds(tx, owner, input.tags)
    const status = await statusForColumn(tx, owner, columnId)

    return tx.task.create({
      data: {
        owner,
        slug,
        title: input.title,
        description: input.description ?? null,
        status,
        completedAt: completionFor(status),
        priority: input.priority,
        projectId: input.projectId ?? null,
        parentTaskId: input.parentTaskId ?? null,
        columnId,
        position,
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        allDay: input.allDay,
        isDraft: input.isDraft ?? false,
        assignees: { create: input.assigneeIds.map((contactId) => ({ contactId })) },
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
      },
      include: taskDetail,
    })
  })
}

export async function updateTask(owner: string, id: string, input: UpsertTaskInput) {
  return ownerTransaction(owner, async (tx) => {
    await validateParent(tx, owner, id, input.parentTaskId)
    await tx.task.findFirstOrThrow({ where: { id, owner }, select: { id: true } })
    await validateLinks(tx, owner, input)
    const tagIds = await resolveTagIds(tx, owner, input.tags)
    await tx.taskAssignee.deleteMany({ where: { taskId: id } })
    await tx.taskTag.deleteMany({ where: { taskId: id } })

    const existing = await tx.task.findUniqueOrThrow({
      where: { id },
      select: { columnId: true, completedAt: true },
    })
    const columnId = input.columnId ?? existing.columnId
    const status = await statusForColumn(tx, owner, columnId)
    // Changing the column from the task sheet is a move, so it needs a position
    // in the destination the same way a drag does. Carrying the old position
    // over dropped the card at an arbitrary depth of the new column, and could
    // tie it exactly with a card already sitting there — which makes the board
    // order non-deterministic and fires a full renormalize on the next drag.
    // `undefined` leaves the column unchanged when the task has not moved.
    const position =
      columnId === existing.columnId ? undefined : await appendPosition(tx, owner, columnId)

    return tx.task.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description ?? null,
        status,
        priority: input.priority,
        projectId: input.projectId ?? null,
        parentTaskId: input.parentTaskId ?? null,
        columnId,
        position,
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        allDay: input.allDay,
        isDraft: input.isDraft ?? false,
        completedAt: completionFor(status, existing.completedAt),
        assignees: { create: input.assigneeIds.map((contactId) => ({ contactId })) },
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
      },
      include: taskDetail,
    })
  })
}

/**
 * Commits a drag. Writes a single fractional position rather than renumbering
 * the column, then renormalizes only if midpoints have collapsed.
 * Dropping into a done column also settles the task's status, so the board and
 * the calendar cannot disagree about what is finished.
 */
export async function moveTask(
  owner: string,
  taskId: string,
  columnId: string,
  toIndex: number,
  projectId?: string | null,
  beforeId?: string | null,
  afterId?: string | null,
) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.task.findFirstOrThrow({ where: { id: taskId, owner }, select: { id: true } })
    await tx.boardColumn.findFirstOrThrow({ where: { id: columnId, owner }, select: { id: true } })
    if (projectId)
      await tx.project.findFirstOrThrow({ where: { id: projectId, owner }, select: { id: true } })
    const siblings = await tx.task.findMany({
      where: { owner, columnId, parentTaskId: null, deletedAt: null, NOT: { id: taskId } },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true, position: true },
    })

    /**
     * K05. `toIndex` is an index into what the USER could see — one project's
     * cards, or one swimlane — while `siblings` is every card in the column.
     * Reading the index against that list picked the wrong neighbours whenever
     * anything was filtered out, so a card dropped below a sibling persisted
     * above it and snapped back on the next refetch.
     *
     * The drag now names its neighbours instead: `beforeId` is the visible card
     * above the drop slot and `afterId` the one below. Ids are stable where an
     * index is not. Looking them up in `siblings` also validates them — an id
     * from another column simply is not there.
     *
     * The midpoint is then taken against the AUTHORITATIVE order, not the
     * visible one: between `beforeId` and whatever actually follows it in the
     * column. A hidden card sitting between the two visible neighbours cannot
     * break that, because any position strictly between them reads correctly on
     * a filtered board, and this one is.
     */
    const at = (id?: string | null) => (id ? siblings.findIndex((s) => s.id === id) : -1)
    const beforeIdx = at(beforeId)
    const afterIdx = at(afterId)

    let position: number
    if (beforeIdx >= 0) {
      position = positionBetween(
        siblings[beforeIdx].position,
        siblings[beforeIdx + 1]?.position ?? null,
      )
    } else if (afterIdx >= 0) {
      position = positionBetween(
        siblings[afterIdx - 1]?.position ?? null,
        siblings[afterIdx].position,
      )
    } else {
      // No usable anchor: an empty column, an append, or both neighbours gone
      // since the drag began. The index is all there is — and with nothing
      // either side of the slot it is unambiguous anyway.
      position = positionForIndex(
        siblings.map((s) => s.position),
        toIndex,
      )
    }

    // Dropping a card into a column is what sets the task's status.
    const status = await statusForColumn(tx, owner, columnId)
    const current = await tx.task.findUnique({
      where: { id: taskId },
      select: { completedAt: true },
    })

    return tx.task.update({
      where: { id: taskId },
      data: {
        columnId,
        position,
        status,
        completedAt: completionFor(status, current?.completedAt),
        ...(projectId !== undefined ? { projectId } : {}),
      },
      include: taskDetail,
    })
  })

  await prisma.$transaction(async (tx) => renormalizeColumn(tx, owner, columnId))
  return result
}

/** Soft delete — recoverable from the trash. */
export async function deleteTask(owner: string, id: string) {
  return softDelete(owner, 'task', id)
}

export async function listDrafts(owner: string) {
  const [contacts, tasks, projects] = await Promise.all([
    prisma.contact.findMany({
      where: { owner, isDraft: true, deletedAt: null },
      select: { id: true, slug: true, displayName: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.task.findMany({
      where: { owner, isDraft: true, deletedAt: null },
      select: { id: true, slug: true, title: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.project.findMany({
      where: { owner, isDraft: true, deletedAt: null },
      select: { id: true, slug: true, name: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])
  return { contacts, tasks, projects }
}
