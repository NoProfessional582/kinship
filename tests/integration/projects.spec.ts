/** /api/projects and /api/projects/[id]. */
import {
  test,
  expect,
  json,
  refused,
  invalid,
  unique,
  newContact,
  newProject,
  newTask,
  type Project,
  type Task,
} from '../support/api'

interface Listed extends Project {
  taskTotal: number
  doneCount: number
  taskCounts: Record<string, number>
  people: { id: string }[]
}

const UNKNOWN = 'no-such-project'

test('a project is created and listed with its task counts and people', async ({
  request,
  cleanup,
}) => {
  const project = await newProject(request, cleanup, {
    name: unique('Garden shed'),
    description: 'Walls first',
    color: '#697760',
    status: 'IN_PROGRESS',
    startDate: '2031-04-01',
    targetDate: '2031-04-30',
  })
  expect(project).toMatchObject({ status: 'IN_PROGRESS', startDate: '2031-04-01T00:00:00.000Z' })
  expect(project.slug).toMatch(/^garden-shed-/)

  const listed = async () =>
    (await json<Listed[]>(await request.get('/api/projects'))).find((p) => p.id === project.id)
  expect(await listed()).toMatchObject({ taskTotal: 0, doneCount: 0, people: [] })

  const contact = await newContact(request, cleanup)
  await newTask(request, cleanup, { projectId: project.id, assigneeIds: [contact.id] })
  const counted = await listed()
  expect(counted).toMatchObject({ taskTotal: 1, doneCount: 0 })
  expect(counted!.taskCounts.TODO).toBe(1)
  expect(counted!.people.map((p) => p.id)).toEqual([contact.id])
})

test('a project reads by id or slug, with its tasks', async ({ request, cleanup }) => {
  const project = await newProject(request, cleanup)
  const task = await newTask(request, cleanup, { projectId: project.id })
  for (const key of [project.id, project.slug]) {
    const read = await json<Project & { tasks: Task[] }>(await request.get(`/api/projects/${key}`))
    expect(read.id).toBe(project.id)
    expect(read.tasks.map((t) => t.id)).toEqual([task.id])
  }
})

test('PATCH saves the whole project the form sends', async ({ request, cleanup }) => {
  const project = await newProject(request, cleanup, { status: 'IN_PROGRESS' })
  const name = unique('Renamed project')
  const saved = await json<Project>(
    await request.patch(`/api/projects/${project.id}`, {
      data: { name, status: 'DONE', targetDate: '2031-05-01' },
    }),
  )
  expect(saved).toMatchObject({ id: project.id, name, status: 'DONE' })
  expect(saved.targetDate).toBe('2031-05-01T00:00:00.000Z')
})

test('a deleted project leaves the list', async ({ request, cleanup }) => {
  const project = await newProject(request, cleanup)
  await json(await request.delete(`/api/projects/${project.id}`))
  await refused(await request.get(`/api/projects/${project.id}`), 404, 'Not found')
  const listed = await json<Listed[]>(await request.get('/api/projects'))
  expect(listed.map((p) => p.id)).not.toContain(project.id)
})

test.describe('refusals', () => {
  test('a project needs a name, a known status and real dates', async ({ request }) => {
    const post = (data: Record<string, unknown>) => request.post('/api/projects', { data })
    await invalid(await post({ name: ' ' }), 'name', 'A name is required')
    await invalid(await post({ name: unique('P'), status: 'SOMEDAY' }), 'status')
    await invalid(await post({ name: unique('P'), targetDate: 'not a date' }), 'targetDate')
  })

  test('an unknown project is not found', async ({ request }) => {
    const data = { name: unique('Nothing') }
    await refused(await request.patch(`/api/projects/${UNKNOWN}`, { data }), 404, 'Not found')
    await refused(await request.delete(`/api/projects/${UNKNOWN}`), 404, 'Not found')
    await refused(await request.get(`/api/projects/${UNKNOWN}`), 404, 'Not found')
  })
})
