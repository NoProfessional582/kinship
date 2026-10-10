import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { deleteColumn, updateColumn } from '@/lib/services/board'
import { ConflictError } from '@/lib/errors'
import { deleteEdgesFor } from '@/lib/services/trash'
import { STEP } from '@/lib/fractional-index'

/**
 * The column is the single source of truth for a card's status, and Task.column
 * cascades. Both facts have teeth, so they are exercised against a real
 * database. Run inside the compose network — see `npm run test:integration`.
 */
const MARK = `__coltest_${Date.now()}__`
const OWNER = `${MARK}owner`
const updateOwnedColumn = (id: string, patch: Parameters<typeof updateColumn>[2]) =>
  updateColumn(OWNER, id, patch)
const deleteOwnedColumn = (id: string) => deleteColumn(OWNER, id)

const makeColumn = (name: string, status: 'TODO' | 'DONE' = 'TODO') =>
  prisma.boardColumn.create({
    data: { owner: OWNER, name: `${MARK}${name}`, status, position: STEP, projectId: null },
  })

const makeTask = (columnId: string, title: string, extra: Record<string, unknown> = {}) =>
  prisma.task.create({
    data: {
      owner: OWNER,
      slug: `${MARK}${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title: `${MARK}${title}`,
      columnId,
      position: STEP,
      ...extra,
    },
  })

afterAll(async () => {
  // Edges carry bare ids with no foreign key behind them, so the sweep has to
  // collect them before the rows go. See lib/services/trash.ts.
  const tasks = await prisma.task.findMany({
    where: { title: { startsWith: MARK } },
    select: { id: true },
  })
  await prisma.task.deleteMany({ where: { title: { startsWith: MARK } } })
  await deleteEdgesFor(
    OWNER,
    'task',
    tasks.map((t) => t.id),
  )
  await prisma.boardColumn.deleteMany({ where: { name: { startsWith: MARK } } })
  await prisma.$disconnect()
})

describe('updateColumn', () => {
  it('carries the cards with a status change', async () => {
    const column = await makeColumn('Waiting')
    const task = await makeTask(column.id, 'Card')
    expect(task.status).toBe('TODO')

    await updateOwnedColumn(column.id, { status: 'BLOCKED' })

    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(after.status).toBe('BLOCKED')
  })

  it('stamps completedAt when the column starts conferring DONE', async () => {
    const column = await makeColumn('Shipped')
    const task = await makeTask(column.id, 'Shipping')
    expect(task.completedAt).toBeNull()

    await updateOwnedColumn(column.id, { status: 'DONE' })

    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(after.status).toBe('DONE')
    expect(after.completedAt).not.toBeNull()
  })

  it('keeps an existing completion instant rather than resetting it', async () => {
    const finished = new Date('2026-01-02T03:04:05Z')
    const column = await makeColumn('Already done', 'DONE')
    const task = await makeTask(column.id, 'Old', { status: 'DONE', completedAt: finished })

    await updateOwnedColumn(column.id, { status: 'DONE' })

    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(after.completedAt?.toISOString()).toBe(finished.toISOString())
  })

  it('clears completedAt when the column stops conferring DONE', async () => {
    const column = await makeColumn('Reopened', 'DONE')
    const task = await makeTask(column.id, 'Reopen', { status: 'DONE', completedAt: new Date() })

    await updateOwnedColumn(column.id, { status: 'IN_PROGRESS' })

    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(after.status).toBe('IN_PROGRESS')
    expect(after.completedAt).toBeNull()
  })

  it('leaves the cards alone when only the name changes', async () => {
    const column = await makeColumn('Renamed', 'DONE')
    const task = await makeTask(column.id, 'Untouched', { status: 'DONE' })

    await updateOwnedColumn(column.id, { name: `${MARK}Renamed twice` })

    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(after.status).toBe('DONE')
  })
})

describe('deleteColumn', () => {
  it('refuses while the column still holds cards', async () => {
    // Task.column cascades, so an unguarded delete would take the card with it
    // -- permanently, straight past the trash.
    const column = await makeColumn('Occupied')
    const task = await makeTask(column.id, 'Hostage')

    // A refusal, not a fault: the API renders ConflictError as a 409.
    await expect(deleteOwnedColumn(column.id)).rejects.toBeInstanceOf(ConflictError)
    await expect(deleteOwnedColumn(column.id)).rejects.toThrow(/move the 1 card/i)

    expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull()
    expect(await prisma.boardColumn.findUnique({ where: { id: column.id } })).not.toBeNull()
  })

  it('refuses while the column holds cards that are only in the trash', async () => {
    const column = await makeColumn('Trashed')
    const task = await makeTask(column.id, 'Recoverable', { deletedAt: new Date() })

    await expect(deleteOwnedColumn(column.id)).rejects.toThrow(/deleted card/i)

    expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull()
  })

  it('removes an empty column', async () => {
    const column = await makeColumn('Empty')

    await deleteOwnedColumn(column.id)

    expect(await prisma.boardColumn.findUnique({ where: { id: column.id } })).toBeNull()
  })
})
