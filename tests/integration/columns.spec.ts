/** /api/columns, /api/columns/[id] and /api/columns/reorder: the board's columns. */
import {
  test,
  expect,
  json,
  refused,
  invalid,
  unique,
  newColumn,
  newTask,
  type Column,
  type Task,
} from '../support/api'
import type { APIRequestContext } from '@playwright/test'

const columns = async (request: APIRequestContext) =>
  json<Column[]>(await request.get('/api/columns'))

const reorder = async (request: APIRequestContext, ids: string[]) =>
  json<Column[]>(await request.patch('/api/columns/reorder', { data: { columnIds: ids } }))

test('a new column goes at the end of the board', async ({ request, cleanup }) => {
  const before = await columns(request)
  const column = await newColumn(request, cleanup, {
    name: unique('Waiting on'),
    status: 'BLOCKED',
    wipLimit: 3,
    color: '#ba8a42',
  })
  expect(column).toMatchObject({ status: 'BLOCKED', wipLimit: 3, color: '#ba8a42' })
  expect(column.position).toBeGreaterThan(Math.max(...before.map((c) => c.position)))
  expect((await columns(request)).map((c) => c.id)).toEqual([...before.map((c) => c.id), column.id])
})

test('PATCH renames a column and clears its limit and colour', async ({ request, cleanup }) => {
  const column = await newColumn(request, cleanup, { wipLimit: 2, color: '#697760' })
  const name = unique('Renamed column')
  const saved = await json<Column>(
    await request.patch(`/api/columns/${column.id}`, {
      data: { name, wipLimit: null, color: null },
    }),
  )
  expect(saved).toMatchObject({ id: column.id, name, wipLimit: null, color: null })
})

test("a column's status carries its cards with it", async ({ request, cleanup }) => {
  const column = await newColumn(request, cleanup, { status: 'BLOCKED' })
  const task = await newTask(request, cleanup, { columnId: column.id })
  expect(task.status).toBe('BLOCKED')
  const read = async () => json<Task>(await request.get(`/api/tasks/${task.id}`))

  await json(await request.patch(`/api/columns/${column.id}`, { data: { status: 'DONE' } }))
  const done = await read()
  expect(done.status).toBe('DONE')
  expect(done.completedAt).not.toBeNull()

  await json(await request.patch(`/api/columns/${column.id}`, { data: { status: 'TODO' } }))
  expect(await read()).toMatchObject({ status: 'TODO', completedAt: null })
})

test('reorder puts the columns in the order sent', async ({ request, cleanup }) => {
  const column = await newColumn(request, cleanup)
  const original = (await columns(request)).map((c) => c.id)
  cleanup.add('restore the column order', () => reorder(request, original))

  const wanted = [column.id, ...original.filter((id) => id !== column.id)]
  expect((await reorder(request, wanted)).map((c) => c.id)).toEqual(wanted)
  expect((await columns(request)).map((c) => c.id)).toEqual(wanted)

  // An id it does not know is skipped; the rest keep their places.
  expect((await reorder(request, ['no-such-column'])).map((c) => c.id)).toEqual(wanted)
  expect((await reorder(request, original)).map((c) => c.id)).toEqual(original)
})

test('a column with cards, even trashed ones, is not removed', async ({ request, cleanup }) => {
  const column = await newColumn(request, cleanup)
  const task = await newTask(request, cleanup, { columnId: column.id })
  const remove = () => request.delete(`/api/columns/${column.id}`)

  await refused(await remove(), 409, 'Move the 1 card out of this column before removing it.')
  await json(await request.delete(`/api/tasks/${task.id}`))
  await refused(
    await remove(),
    409,
    'This column still holds 1 deleted card. Restore them or empty the trash first — ' +
      'removing the column would delete them for good.',
  )
  await json(
    await request.post('/api/trash', { data: { action: 'purge', kind: 'task', id: task.id } }),
  )
  await json(await remove())
  expect((await columns(request)).map((c) => c.id)).not.toContain(column.id)
})

test.describe('refusals', () => {
  test('a column needs a name, a known status and a limit of 1 or more', async ({ request }) => {
    const post = (data: Record<string, unknown>) => request.post('/api/columns', { data })
    await invalid(await post({ name: '' }), 'name')
    await invalid(await post({ name: unique('C'), status: 'LATER' }), 'status')
    await invalid(await post({ name: unique('C'), wipLimit: 0 }), 'wipLimit')
  })

  test('reorder needs at least one column', async ({ request }) => {
    await invalid(
      await request.patch('/api/columns/reorder', { data: { columnIds: [] } }),
      'columnIds',
    )
  })

  test('an unknown column is not found', async ({ request }) => {
    await refused(
      await request.patch('/api/columns/no-such-column', { data: { name: 'x' } }),
      404,
      'Not found',
    )
    await refused(await request.delete('/api/columns/no-such-column'), 404, 'Not found')
  })
})
