/** /api/edges and /api/edges/[id]: relationships between any two records. */
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
} from '../support/api'

interface Edge {
  id: string
  relation: string
  note: string | null
  weight: number
}

interface Linked {
  id: string
  relation: string
  note: string | null
  direction: 'in' | 'out'
  otherType: string
  otherId: string
  label: string
  href: string
}

const UNKNOWN = 'no-such-record'

test('a relationship reads from both ends, and saving it again updates it', async ({
  request,
  cleanup,
}) => {
  const [a, b] = [await newContact(request, cleanup), await newContact(request, cleanup)]
  const data = {
    sourceType: 'contact',
    sourceId: a.id,
    targetType: 'contact',
    targetId: b.id,
    relation: 'mentors',
    note: 'Since 2024',
  }
  const edge = await json<Edge>(await request.post('/api/edges', { data }))
  expect(edge).toMatchObject({ relation: 'mentors', note: 'Since 2024', weight: 1 })

  const again = await json<Edge>(
    await request.post('/api/edges', { data: { ...data, note: 'Since 2023', weight: 5 } }),
  )
  expect(again).toMatchObject({ id: edge.id, note: 'Since 2023', weight: 5 })

  const fromA = await json<Linked[]>(await request.get(`/api/edges?type=contact&id=${a.id}`))
  expect(fromA).toEqual([
    {
      id: edge.id,
      relation: 'mentors',
      note: 'Since 2023',
      direction: 'out',
      otherType: 'contact',
      otherId: b.id,
      label: b.displayName,
      href: `/contacts/${b.slug}`,
    },
  ])
  const fromB = await json<Linked[]>(await request.get(`/api/edges?type=contact&id=${b.id}`))
  expect(fromB).toMatchObject([
    { id: edge.id, direction: 'in', otherId: a.id, label: a.displayName },
  ])

  await json(await request.delete(`/api/edges/${edge.id}`))
  expect(await json(await request.get(`/api/edges?type=contact&id=${a.id}`))).toEqual([])
})

test('a contact relates to projects, tasks and notes, each with its own link', async ({
  request,
  cleanup,
}) => {
  const contact = await newContact(request, cleanup)
  const project = await newProject(request, cleanup)
  const task = await newTask(request, cleanup)
  const { entry } = await newEntry(request, cleanup)
  for (const [targetType, targetId] of [
    ['project', project.id],
    ['task', task.id],
    ['entry', entry.id],
  ]) {
    await json(
      await request.post('/api/edges', {
        data: {
          sourceType: 'contact',
          sourceId: contact.id,
          targetType,
          targetId,
          relation: 'works on',
        },
      }),
    )
  }
  const linked = await json<Linked[]>(await request.get(`/api/edges?type=contact&id=${contact.id}`))
  expect(linked.map(({ otherType, label, href }) => ({ otherType, label, href }))).toEqual([
    { otherType: 'project', label: project.name, href: `/projects/${project.slug}` },
    { otherType: 'task', label: task.title, href: `/board?task=${task.id}` },
    { otherType: 'entry', label: entry.title, href: `/notes/${entry.id}` },
  ])
  // The far end sees it too.
  const fromTask = await json<Linked[]>(await request.get(`/api/edges?type=task&id=${task.id}`))
  expect(fromTask).toMatchObject([{ direction: 'in', otherId: contact.id }])
})

test.describe('refusals', () => {
  test('a record cannot relate to itself', async ({ request, cleanup }) => {
    const contact = await newContact(request, cleanup)
    const self = { type: 'contact', id: contact.id }
    await refused(
      await request.post('/api/edges', {
        data: {
          sourceType: self.type,
          sourceId: self.id,
          targetType: self.type,
          targetId: self.id,
          relation: 'is',
        },
      }),
      400,
      'An entity cannot relate to itself',
    )
  })

  test('a relationship needs known types, a name and a weight from 1 to 100', async ({
    request,
    cleanup,
  }) => {
    const [a, b] = [await newContact(request, cleanup), await newContact(request, cleanup)]
    const post = (data: Record<string, unknown>) =>
      request.post('/api/edges', {
        data: {
          sourceType: 'contact',
          sourceId: a.id,
          targetType: 'contact',
          targetId: b.id,
          relation: 'knows',
          ...data,
        },
      })
    await invalid(await post({ sourceType: 'tag' }), 'sourceType')
    await invalid(await post({ relation: ' ' }), 'relation')
    await invalid(await post({ weight: 0 }), 'weight')
    await invalid(await post({ targetId: '' }), 'targetId')
  })

  test('both ends must exist', async ({ request, cleanup }) => {
    const contact = await newContact(request, cleanup)
    await refused(
      await request.post('/api/edges', {
        data: {
          sourceType: 'contact',
          sourceId: contact.id,
          targetType: 'project',
          targetId: UNKNOWN,
          relation: 'owns',
        },
      }),
      404,
      'Not found',
    )
    await refused(await request.get(`/api/edges?type=contact&id=${UNKNOWN}`), 404, 'Not found')
    await refused(await request.delete(`/api/edges/${UNKNOWN}`), 404, 'Not found')
  })

  test('listing for an unknown type, or for no id, is refused', async ({ request }) => {
    await invalid(await request.get(`/api/edges?type=bogus&id=${UNKNOWN}`), 'type')
    await invalid(await request.get(`/api/edges?type=&id=${UNKNOWN}`), 'type')
    await invalid(await request.get('/api/edges?type=contact'), 'id')
  })
})
