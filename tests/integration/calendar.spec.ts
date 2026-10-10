/**
 * /api/calendar: the merged feed of task deadlines, entries, project spans and birthdays,
 * and dragging one to another day. Everything here is dated March 2031, a month nothing
 * else in the stack touches.
 */
import {
  test,
  expect,
  json,
  refused,
  invalid,
  newContact,
  newEntry,
  newProject,
  newTask,
  type Entry,
  type Project,
  type Task,
} from '../support/api'
import type { APIRequestContext } from '@playwright/test'

interface CalendarEvent {
  id: string
  title: string
  start: string
  end?: string
  allDay: boolean
  source: string
  category: string
  entityId: string
  editable: boolean
}

const MARCH = 'start=2031-03-01T00:00:00.000Z&end=2031-04-01T00:00:00.000Z'

const feed = async (request: APIRequestContext, window = MARCH) =>
  json<CalendarEvent[]>(await request.get(`/api/calendar?${window}`))

const reschedule = (request: APIRequestContext, data: Record<string, unknown>) =>
  request.patch('/api/calendar', { data })

test('the feed holds deadlines, entries, project spans and birthdays in the window', async ({
  request,
  cleanup,
}) => {
  const task = await newTask(request, cleanup, { dueDate: '2031-03-12' })
  const { entry } = await newEntry(request, cleanup, {
    kind: 'EVENT',
    occurredAt: '2031-03-14T15:00:00.000Z',
    durationMin: 30,
  })
  const project = await newProject(request, cleanup, {
    startDate: '2031-03-20',
    targetDate: '2031-03-25',
  })
  const contact = await newContact(request, cleanup, { birthday: '1990-03-17' })
  const { entry: later } = await newEntry(request, cleanup, {
    occurredAt: '2031-05-01T10:00:00.000Z',
  })

  const events = await feed(request)
  const byId = new Map(events.map((e) => [e.id, e]))
  expect(byId.get(`task:${task.id}`)).toMatchObject({
    title: task.title,
    start: '2031-03-12',
    allDay: true,
    source: 'task',
    category: 'deadline',
    entityId: task.id,
    editable: true,
  })
  expect(byId.get(`entry:${entry.id}`)).toMatchObject({
    start: '2031-03-14T15:00:00.000Z',
    end: '2031-03-14T15:30:00.000Z',
    allDay: false,
    category: 'event',
  })
  // An all-day span ends the day after its last day, as the calendar widget reads it.
  expect(byId.get(`project:${project.id}`)).toMatchObject({
    start: '2031-03-20',
    end: '2031-03-26',
    allDay: true,
    category: 'deadline',
    entityId: project.slug,
  })
  expect(byId.get(`birthday:${contact.id}:2031`)).toMatchObject({
    start: '2031-03-17',
    allDay: true,
    category: 'milestone',
    editable: false,
  })
  expect(byId.has(`entry:${later.id}`)).toBe(false)
})

test('dragging moves a deadline, an entry and a project span', async ({ request, cleanup }) => {
  const task = await newTask(request, cleanup, { dueDate: '2031-03-12' })
  const { entry } = await newEntry(request, cleanup, {
    occurredAt: '2031-03-14T15:00:00.000Z',
    durationMin: 30,
  })
  const project = await newProject(request, cleanup, {
    startDate: '2031-03-20',
    targetDate: '2031-03-25',
  })

  await json(await reschedule(request, { source: 'task', entityId: task.id, start: '2031-03-13' }))
  expect((await json<Task>(await request.get(`/api/tasks/${task.id}`))).dueDate).toBe(
    '2031-03-13T00:00:00.000Z',
  )

  await json(
    await reschedule(request, {
      source: 'entry',
      entityId: entry.id,
      start: '2031-03-15T16:00:00.000Z',
      end: '2031-03-15T17:00:00.000Z',
    }),
  )
  expect(await json<Entry>(await request.get(`/api/entries/${entry.id}`))).toMatchObject({
    occurredAt: '2031-03-15T16:00:00.000Z',
    durationMin: 60,
  })

  // Projects are dragged by slug; the exclusive end comes back as the last day.
  await json(
    await reschedule(request, {
      source: 'project',
      entityId: project.slug,
      start: '2031-03-21',
      end: '2031-03-27',
    }),
  )
  expect(await json<Project>(await request.get(`/api/projects/${project.id}`))).toMatchObject({
    startDate: '2031-03-21T00:00:00.000Z',
    targetDate: '2031-03-26T00:00:00.000Z',
  })
})

test.describe('refusals', () => {
  test('the feed needs a real start and end', async ({ request }) => {
    await invalid(await request.get('/api/calendar'), 'start')
    await invalid(await request.get('/api/calendar?start=2031-03-01'), 'end')
    await invalid(await request.get('/api/calendar?start=soon&end=2031-04-01'), 'start')
  })

  test('a drag needs a known source, an id and a real date', async ({ request }) => {
    await invalid(
      await reschedule(request, { source: 'birthday', entityId: 'x', start: '2031-03-01' }),
      'source',
    )
    await invalid(
      await reschedule(request, { source: 'task', entityId: '', start: '2031-03-01' }),
      'entityId',
    )
    await invalid(
      await reschedule(request, { source: 'task', entityId: 'x', start: 'tomorrow' }),
      'start',
    )
  })

  test('an unknown task, entry or project is not found', async ({ request }) => {
    const start = '2031-03-01'
    await refused(
      await reschedule(request, { source: 'task', entityId: 'no-such-task', start }),
      404,
      'Not found',
    )
    await refused(
      await reschedule(request, { source: 'entry', entityId: 'no-such-entry', start }),
      404,
      'Not found',
    )
    await refused(
      await reschedule(request, { source: 'project', entityId: 'no-such-project', start }),
      404,
      'Not found',
    )
  })
})

test('includes encompassing spans and keeps timed windows exclusive', async ({
  request,
  cleanup,
}) => {
  const task = await newTask(request, cleanup, {
    startDate: '2031-02-01',
    dueDate: '2031-05-01',
    allDay: true,
  })
  const project = await newProject(request, cleanup, {
    startDate: '2031-02-01',
    targetDate: '2031-05-01',
    allDay: true,
  })
  const timed = await newTask(request, cleanup, {
    startDate: '2031-02-01T12:00:00Z',
    dueDate: '2031-05-01T12:00:00Z',
    allDay: false,
  })
  const before = await newTask(request, cleanup, {
    startDate: '2031-02-20T12:00:00Z',
    dueDate: '2031-03-01T00:00:00Z',
    allDay: false,
  })
  const after = await newTask(request, cleanup, {
    startDate: '2031-04-01T00:00:00Z',
    dueDate: '2031-04-02T00:00:00Z',
    allDay: false,
  })
  const single = await newTask(request, cleanup, { dueDate: '2031-03-01T00:00:00Z', allDay: false })
  const startOnly = await newTask(request, cleanup, {
    startDate: '2031-03-31T23:59:00Z',
    allDay: false,
  })
  const zero = await newTask(request, cleanup, {
    startDate: '2031-03-01T00:00:00Z',
    dueDate: '2031-03-01T00:00:00Z',
    allDay: false,
  })
  const events = await feed(request)
  const ids = events.map((e) => e.id)
  for (const t of [task, timed, single, startOnly, zero]) expect(ids).toContain(`task:${t.id}`)
  for (const t of [before, after]) expect(ids).not.toContain(`task:${t.id}`)
  expect(events.find((e) => e.id === `project:${project.id}`)).toMatchObject({
    start: '2031-02-01',
    end: '2031-05-02',
  })
  expect(events.find((e) => e.id === `task:${timed.id}`)).toMatchObject({
    start: '2031-02-01T12:00:00.000Z',
    end: '2031-05-01T12:00:00.000Z',
  })
})

test('timezone widening is limited to all-day dates', async ({ request, cleanup }) => {
  const allDay = await newTask(request, cleanup, { dueDate: '2031-03-01', allDay: true })
  const timed = await newTask(request, cleanup, { dueDate: '2031-03-01T00:00:00Z', allDay: false })
  const allDayOutside = await newTask(request, cleanup, {
    startDate: '2031-01-01',
    dueDate: '2031-01-31',
    allDay: true,
  })
  const project = await newProject(request, cleanup, { targetDate: '2031-03-01', allDay: true })
  const events = await feed(request, 'start=2031-03-01T08:00:00Z&end=2031-04-01T07:00:00Z')
  const ids = events.map((e) => e.id)
  expect(ids).toContain(`task:${allDay.id}`)
  expect(ids).toContain(`project:${project.id}`)
  expect(ids).not.toContain(`task:${timed.id}`)
  expect(ids).not.toContain(`task:${allDayOutside.id}`)
})
