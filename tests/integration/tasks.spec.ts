/** /api/tasks (the board), /api/tasks/[id] and /api/tasks/[id]/move. */
import {
  test,
  expect,
  json,
  refused,
  invalid,
  unique,
  newColumn,
  newContact,
  newProject,
  newTask,
  type Column,
  type Task,
} from '../support/api'
import type { APIRequestContext } from '@playwright/test'

interface Board {
  columns: Column[]
  tasks: Task[]
}

const UNKNOWN = 'no-such-task'

const board = async (request: APIRequestContext, query = '') =>
  json<Board>(await request.get(`/api/tasks${query}`))

/** The column a status starts in on the default board. */
const columnFor = async (request: APIRequestContext, status: string) => {
  const column = (await board(request)).columns.find((c) => c.status === status)
  expect(column, `a ${status} column`).toBeTruthy()
  return column!
}

/** The ids of the cards in a column, in board order. */
const cardsIn = async (request: APIRequestContext, columnId: string) =>
  (await board(request)).tasks.filter((t) => t.columnId === columnId).map((t) => t.id)

test('the board is the columns and the top-level cards', async ({ request }) => {
  const { columns, tasks } = await board(request)
  expect(columns.length).toBeGreaterThanOrEqual(5)
  const positions = columns.map((c) => c.position)
  expect(positions).toEqual([...positions].sort((a, b) => a - b))
  expect(tasks.every((t) => t.parentTaskId === null)).toBe(true)
})

test('a task lands in the first column, with its project, people, tags and date', async ({
  request,
  cleanup,
}) => {
  const project = await newProject(request, cleanup)
  const contact = await newContact(request, cleanup)
  const tag = unique('tag').replaceAll(' ', '-')
  const task = await newTask(request, cleanup, {
    title: unique('Paint the fence'),
    priority: 'HIGH',
    projectId: project.id,
    assigneeIds: [contact.id],
    tags: [tag],
    dueDate: '2031-06-01',
  })
  const first = (await board(request)).columns[0]
  expect(task).toMatchObject({
    columnId: first.id,
    status: first.status,
    priority: 'HIGH',
    projectId: project.id,
    dueDate: '2031-06-01T00:00:00.000Z',
    completedAt: null,
  })
  expect(task.assignees.map((a) => a.contact.id)).toEqual([contact.id])
  expect(task.tags.map((t) => t.tag.name)).toEqual([tag])

  // Filtered to the project, the board shows only its cards.
  const filtered = await board(request, `?projectId=${project.id}`)
  expect(filtered.tasks.map((t) => t.id)).toEqual([task.id])

  for (const key of [task.id, task.slug]) {
    const read = await json<Task & { parent: null }>(await request.get(`/api/tasks/${key}`))
    expect(read).toMatchObject({ id: task.id, parent: null, subtasks: [] })
  }
})

test('a task created in a done column is done', async ({ request, cleanup }) => {
  const done = await columnFor(request, 'DONE')
  const task = await newTask(request, cleanup, { columnId: done.id })
  expect(task.status).toBe('DONE')
  expect(task.completedAt).not.toBeNull()
})

test('a subtask shows inside its parent, not on the board', async ({ request, cleanup }) => {
  const parent = await newTask(request, cleanup)
  const child = await newTask(request, cleanup, { parentTaskId: parent.id })
  const read = await json<Task>(await request.get(`/api/tasks/${parent.id}`))
  expect(read.subtasks.map((s) => s.id)).toEqual([child.id])
  expect((await board(request)).tasks.map((t) => t.id)).not.toContain(child.id)
})

test('PATCH saves the task; its column sets its status', async ({ request, cleanup }) => {
  const task = await newTask(request, cleanup)
  const doing = await columnFor(request, 'IN_PROGRESS')
  const done = await columnFor(request, 'DONE')
  const title = unique('Retitled task')
  const patch = (data: Record<string, unknown>) =>
    request.patch(`/api/tasks/${task.id}`, { data: { title, ...data } })

  expect(await json<Task>(await patch({ columnId: doing.id }))).toMatchObject({
    title,
    status: 'IN_PROGRESS',
    completedAt: null,
  })
  const finished = await json<Task>(await patch({ columnId: done.id }))
  expect(finished.status).toBe('DONE')
  expect(finished.completedAt).not.toBeNull()
  expect(await json<Task>(await patch({ columnId: doing.id }))).toMatchObject({
    completedAt: null,
  })
})

test('a move places the card between the neighbours it names', async ({ request, cleanup }) => {
  const column = await newColumn(request, cleanup, { status: 'BLOCKED' })
  const [a, b, c] = [
    await newTask(request, cleanup, { columnId: column.id }),
    await newTask(request, cleanup, { columnId: column.id }),
    await newTask(request, cleanup, { columnId: column.id }),
  ]
  expect(await cardsIn(request, column.id)).toEqual([a.id, b.id, c.id])

  const move = (task: Task, data: Record<string, unknown>) =>
    request.patch(`/api/tasks/${task.id}/move`, { data: { columnId: column.id, ...data } })
  await json(await move(c, { toIndex: 1, beforeId: a.id, afterId: b.id }))
  expect(await cardsIn(request, column.id)).toEqual([a.id, c.id, b.id])
  await json(await move(a, { toIndex: 2, beforeId: b.id, afterId: null }))
  expect(await cardsIn(request, column.id)).toEqual([c.id, b.id, a.id])

  // Into another column: the card takes that column's status.
  const done = await columnFor(request, 'DONE')
  const moved = await json<Task>(
    await request.patch(`/api/tasks/${b.id}/move`, { data: { columnId: done.id, toIndex: 0 } }),
  )
  expect(moved).toMatchObject({ columnId: done.id, status: 'DONE' })
  expect(moved.completedAt).not.toBeNull()
  expect(await cardsIn(request, column.id)).toEqual([c.id, a.id])
})

test('a deleted task leaves the board', async ({ request, cleanup }) => {
  const task = await newTask(request, cleanup)
  await json(await request.delete(`/api/tasks/${task.id}`))
  expect(await json(await request.get(`/api/tasks/${task.id}`))).toBeNull()
  expect((await board(request)).tasks.map((t) => t.id)).not.toContain(task.id)
})

test.describe('refusals', () => {
  test('a task needs a title and a known priority', async ({ request }) => {
    const post = (data: Record<string, unknown>) => request.post('/api/tasks', { data })
    await invalid(await post({ title: '' }), 'title', 'A title is required')
    await invalid(await post({ title: unique('T'), priority: 'WHENEVER' }), 'priority')
    await invalid(await post({ title: unique('T'), dueDate: 'soon' }), 'dueDate')
  })

  test('a task cannot point at records that do not exist', async ({ request }) => {
    const post = (data: Record<string, unknown>) =>
      request.post('/api/tasks', { data: { title: unique('Orphan'), ...data } })
    await refused(await post({ projectId: 'no-such-project' }), 404, 'Not found')
    await refused(await post({ parentTaskId: UNKNOWN }), 404, 'Not found')
    await refused(await post({ columnId: 'no-such-column' }), 404, 'Not found')
    await refused(await post({ assigneeIds: ['no-such-contact'] }), 404, 'Not found')
  })

  test('a move needs a column and an index of 0 or more', async ({ request, cleanup }) => {
    const task = await newTask(request, cleanup)
    const move = (data: Record<string, unknown>) =>
      request.patch(`/api/tasks/${task.id}/move`, { data })
    await invalid(await move({ toIndex: 0 }), 'columnId')
    await invalid(await move({ columnId: task.columnId, toIndex: -1 }), 'toIndex')
    await refused(await move({ columnId: 'no-such-column', toIndex: 0 }), 404, 'Not found')
  })

  test('an unknown task is not found', async ({ request }) => {
    const data = { title: unique('Nothing') }
    await refused(await request.patch(`/api/tasks/${UNKNOWN}`, { data }), 404, 'Not found')
    await refused(
      await request.patch(`/api/tasks/${UNKNOWN}/move`, {
        data: { columnId: (await board(request)).columns[0].id, toIndex: 0 },
      }),
      404,
      'Not found',
    )
    await refused(await request.delete(`/api/tasks/${UNKNOWN}`), 404, 'Not found')
    await refused(await request.get('/api/tasks?projectId=no-such-project'), 404, 'Not found')
  })

  // ⚠️ Not a 404: reading an unknown task answers null, which the task sheet shows as not
  // found (master.md, open question 13).
  test('reading an unknown task answers null', async ({ request }) => {
    expect(await json(await request.get(`/api/tasks/${UNKNOWN}`))).toBeNull()
  })
})
