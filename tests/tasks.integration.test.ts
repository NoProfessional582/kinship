import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { ensureColumns } from '@/lib/services/board'
import { getBoard, getTask, moveTask } from '@/lib/services/tasks'
import { restore, softDelete, deleteEdgesFor } from '@/lib/services/trash'

/**
 * Board ordering and subtask visibility against a real database (K05, K06).
 *
 * K05 only reproduces when the column holds cards the board is NOT showing, so
 * every ordering spec here interleaves a second project's cards into the same
 * column and then drives a move as the filtered board would.
 */
const MARK = `__tasktest_${Date.now()}__`
const OWNER = `${MARK}owner`

let columnId = ''
const projects: Record<string, string> = {}

async function column() {
  if (!columnId) {
    const c = await prisma.boardColumn.create({
      data: { owner: OWNER, name: `${MARK}col`, status: 'TODO', position: 1000, projectId: null },
    })
    columnId = c.id
  }
  return columnId
}

async function project(key: string) {
  if (!projects[key]) {
    const p = await prisma.project.create({
      data: {
        owner: OWNER,
        slug: `${MARK}${key}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: `${MARK}${key}`,
      },
    })
    projects[key] = p.id
  }
  return projects[key]
}

async function task(
  title: string,
  position: number,
  projectKey?: string,
  extra: Record<string, unknown> = {},
) {
  return prisma.task.create({
    data: {
      owner: OWNER,
      slug: `${MARK}${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title: `${MARK}${title}`,
      columnId: await column(),
      position,
      ...(projectKey ? { projectId: await project(projectKey) } : {}),
      ...extra,
    },
  })
}

/** Titles in this column, in stored order, for one project — i.e. what the board shows. */
async function visibleOrder(projectKey: string) {
  const rows = await prisma.task.findMany({
    where: {
      owner: OWNER,
      columnId: await column(),
      projectId: await project(projectKey),
      deletedAt: null,
      parentTaskId: null,
    },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: { title: true },
  })
  return rows.map((r) => r.title.replace(MARK, ''))
}

afterAll(async () => {
  const ids = await prisma.task.findMany({
    where: { title: { startsWith: MARK } },
    select: { id: true },
  })
  await prisma.task.deleteMany({ where: { title: { startsWith: MARK } } })
  await deleteEdgesFor(
    OWNER,
    'task',
    ids.map((t) => t.id),
  )
  await prisma.project.deleteMany({ where: { name: { startsWith: MARK } } })
  await prisma.boardColumn.deleteMany({ where: { name: { startsWith: MARK } } })
  await prisma.$disconnect()
})

describe('moveTask — ordering on a filtered board (K05)', () => {
  // Each spec gets a column of its own. They seed fixed positions (1000, 2000,
  // ...), so in a shared column they tie with earlier specs' cards, Postgres
  // returns equal positions in no fixed order, and a spec passed or failed by
  // chance.
  beforeEach(() => {
    columnId = ''
  })

  it('honours the drop slot when a hidden project interleaves the column', async () => {
    // Stored order: hidden, hidden, A, B. The board filtered to "visible" shows
    // only A then B, so dragging A below B is visible index 1.
    await task('h1', 1000, 'hidden')
    await task('h2', 2000, 'hidden')
    const a = await task('vis-a', 3000, 'visible')
    const b = await task('vis-b', 4000, 'visible')

    expect(await visibleOrder('visible')).toEqual(['vis-a', 'vis-b'])

    await moveTask(OWNER, a.id, await column(), 1, await project('visible'), b.id, null)

    // The user dropped A *below* B, so that is where it must be — and this is a
    // fresh read, which is the exact thing that used to snap it back.
    expect(await visibleOrder('visible')).toEqual(['vis-b', 'vis-a'])
  })

  it('CONTROL: the index-only path puts it back in the wrong place', async () => {
    // Same shape, no neighbour ids — the pre-K05 call. `toIndex` 1 is read
    // against the whole column (h1, h2, B), so the midpoint lands between the
    // two HIDDEN cards and A stays above B. This is the bug, kept as a spec so
    // the fix above cannot quietly stop being load-bearing.
    await task('c-h1', 1000, 'chidden')
    await task('c-h2', 2000, 'chidden')
    const a = await task('c-a', 3000, 'cvisible')
    await task('c-b', 4000, 'cvisible')

    await moveTask(OWNER, a.id, await column(), 1, await project('cvisible'))

    expect(await visibleOrder('cvisible')).toEqual(['c-a', 'c-b'])
  })

  it('places a card at the top of a filtered board', async () => {
    await task('t-h', 1000, 'thidden')
    const a = await task('t-a', 2000, 'tvisible')
    const b = await task('t-b', 3000, 'tvisible')

    await moveTask(OWNER, b.id, await column(), 0, await project('tvisible'), null, a.id)

    expect(await visibleOrder('tvisible')).toEqual(['t-b', 't-a'])
  })

  it('ignores neighbour ids that belong to another column', async () => {
    const other = await prisma.boardColumn.create({
      data: { owner: OWNER, name: `${MARK}other`, status: 'TODO', position: 2000, projectId: null },
    })
    const stranger = await prisma.task.create({
      data: {
        owner: OWNER,
        slug: `${MARK}stranger`,
        title: `${MARK}stranger`,
        columnId: other.id,
        position: 1000,
      },
    })
    const a = await task('x-a', 1000, 'xvisible')
    await task('x-b', 2000, 'xvisible')

    // A stale client naming a card from somewhere else must not throw and must
    // not be trusted; the index fallback takes over.
    await expect(
      moveTask(OWNER, a.id, await column(), 1, await project('xvisible'), stranger.id, null),
    ).resolves.toBeTruthy()

    const still = await prisma.task.findUniqueOrThrow({ where: { id: a.id } })
    expect(still.columnId).toBe(await column())
  })
})

describe('taskDetail — soft-deleted subtasks (K06)', () => {
  it('hides a trashed subtask from its parent, in the list and the count', async () => {
    const parent = await task('p', 5000, 'visible')
    const keep = await task('s-keep', 6000, 'visible', { parentTaskId: parent.id })
    const gone = await task('s-gone', 7000, 'visible', { parentTaskId: parent.id })

    let detail = await getTask(OWNER, parent.id)
    expect(detail!.subtasks).toHaveLength(2)
    expect(detail!._count.subtasks).toBe(2)

    await softDelete(OWNER, 'task', gone.id)

    detail = await getTask(OWNER, parent.id)
    expect(detail!.subtasks.map((s: any) => s.id)).toEqual([keep.id])
    // The count is the half that showed "2 subtasks" over a list of one.
    expect(detail!._count.subtasks).toBe(1)

    // The child itself is hidden everywhere, consistently.
    expect(await getTask(OWNER, gone.id)).toBeNull()

    // And it is still recoverable — hiding it is not losing it.
    await restore(OWNER, 'task', gone.id)
    detail = await getTask(OWNER, parent.id)
    expect(detail!.subtasks).toHaveLength(2)
    expect(detail!._count.subtasks).toBe(2)
  })

  it('applies the same filter on the board', async () => {
    const parent = await task('bp', 8000, 'visible')
    const child = await task('bs', 9000, 'visible', { parentTaskId: parent.id })
    await softDelete(OWNER, 'task', child.id)

    const board = await getBoard(OWNER, await project('visible'))
    const card = board.tasks.find((t: any) => t.id === parent.id)
    expect(card).toBeTruthy()
    expect(card!.subtasks).toHaveLength(0)
    expect(card!._count.subtasks).toBe(0)
  })
})

describe('board order — equal positions', () => {
  // Each spec stores two rows at one position, in the opposite order to their
  // ids. Ordered by position alone, Postgres may return them either way, and
  // usually returns them as stored; ordered by position then id, never.
  beforeEach(() => {
    columnId = ''
  })

  it('returns two cards at one position in id order', async () => {
    const b = await task('tie-b', 1000, 'tie', { id: `${MARK}tie-b` })
    const a = await task('tie-a', 1000, 'tie', { id: `${MARK}tie-a` })

    const board = await getBoard(OWNER, await project('tie'))
    const cards = board.tasks.filter((t) => t.columnId === columnId).map((t) => t.id)
    expect(cards).toEqual([a.id, b.id])
  })

  it('returns two subtasks at one position in id order', async () => {
    const parent = await task('tie-parent', 1000, 'tie')
    const b = await task('tie-sub-b', 2000, 'tie', {
      id: `${MARK}tie-sub-b`,
      parentTaskId: parent.id,
    })
    const a = await task('tie-sub-a', 2000, 'tie', {
      id: `${MARK}tie-sub-a`,
      parentTaskId: parent.id,
    })

    const detail = await getTask(OWNER, parent.id)
    expect(detail!.subtasks.map((s) => s.id)).toEqual([a.id, b.id])
  })

  it('returns two columns at one position in id order', async () => {
    const owner = `${MARK}tie-columns`
    for (const key of ['b', 'a']) {
      await prisma.boardColumn.create({
        data: {
          id: `${MARK}tie-col-${key}`,
          owner,
          name: `${MARK}tie-col-${key}`,
          status: 'TODO',
          position: 1000,
          projectId: null,
        },
      })
    }

    const columns = await ensureColumns(prisma, owner)
    expect(columns.map((c) => c.id)).toEqual([`${MARK}tie-col-a`, `${MARK}tie-col-b`])
  })
})
