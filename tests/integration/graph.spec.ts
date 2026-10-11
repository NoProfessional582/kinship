/** /api/graph: the 3D map's read-only graph, over HTTP. */
import type { APIRequestContext } from '@playwright/test'
import {
  test,
  expect,
  json,
  refused,
  doc,
  paragraph,
  text,
  mention,
  reference,
  newContact,
  newEntry,
  newProject,
  newTask,
  unique,
} from '../support/api'

// The contract's shapes (docs/api/graph.openapi.json); the tests import nothing from the app.
interface GraphNode {
  id: string
  entityId: string
  type: 'contact' | 'project' | 'entry' | 'task' | 'tag'
  name: string
  subtitle?: string
  description?: string
  color: string
  url: string | null
}

interface GraphLink {
  id: string
  source: string
  target: string
  relation: string
  origins: string[]
}

interface Graph {
  nodes: GraphNode[]
  links: GraphLink[]
}

const NODE_KEYS = ['color', 'description', 'entityId', 'id', 'name', 'subtitle', 'type', 'url']
const LINK_KEYS = ['id', 'origins', 'relation', 'source', 'target']
const COLORS = {
  contact: '#3b82f6',
  project: '#8b5cf6',
  entry: '#ec4899',
  task: '#f59e0b',
  tag: '#10b981',
}

/** A graph answer, with the contract's shape checked: no stray fields, no link to a missing node. */
function checked(graph: Graph) {
  expect(Object.keys(graph).sort()).toEqual(['links', 'nodes'])
  const ids = new Set<string>()
  for (const n of graph.nodes) {
    expect(NODE_KEYS, JSON.stringify(n)).toEqual(expect.arrayContaining(Object.keys(n)))
    expect(n.id).toBe(`${n.type}:${n.entityId}`)
    expect(n.color).toBe(COLORS[n.type])
    expect(ids.has(n.id), `${n.id} twice`).toBe(false)
    ids.add(n.id)
  }
  const linkIds = new Set<string>()
  for (const l of graph.links) {
    expect(Object.keys(l).sort()).toEqual(LINK_KEYS)
    expect(ids.has(l.source) && ids.has(l.target), `${l.id} ends on nodes`).toBe(true)
    expect(l.origins).toEqual([...l.origins].sort())
    expect(linkIds.has(l.id), `${l.id} twice`).toBe(false)
    linkIds.add(l.id)
  }
  return graph
}

const graph = async (api: APIRequestContext, query = '') =>
  checked(await json<Graph>(await api.get(`/api/graph${query}`)))

const linksOf = (g: Graph) => g.links.map((l) => `${l.source} -${l.relation}-> ${l.target}`).sort()

test('the whole graph holds new records and their links, uncached', async ({
  request,
  cleanup,
}) => {
  const label = unique('graph-spec').replace(/\s+/g, '-')
  const project = await newProject(request, cleanup)
  const person = await newContact(request, cleanup, { tags: [label] })
  const task = await newTask(request, cleanup, { projectId: project.id, assigneeIds: [person.id] })
  const { entry } = await newEntry(request, cleanup, {
    bodyJson: doc(
      paragraph(
        text('Talked with '),
        mention(person.id, person.displayName),
        text(' about '),
        reference('task', task.id, task.title),
      ),
    ),
  })

  const response = await request.get('/api/graph')
  expect(response.headers()['cache-control']).toContain('no-store')
  const g = checked(await json<Graph>(response))
  const node = (type: string, id: string) => g.nodes.find((n) => n.id === `${type}:${id}`)

  expect(node('contact', person.id)).toMatchObject({
    name: person.displayName,
    url: `/contacts/${person.slug}`,
  })
  expect(node('project', project.id)?.url).toBe(`/projects/${project.slug}`)
  expect(node('task', task.id)?.url).toBe(`/board?task=${task.id}`)
  expect(node('entry', entry.id)).toMatchObject({
    url: `/notes/${entry.id}`,
    description: expect.any(String),
  })
  const tag = g.nodes.find((n) => n.type === 'tag' && n.name === label)
  expect(tag?.url).toBeNull()

  const mine = linksOf({
    nodes: [],
    links: g.links.filter((l) =>
      [person.id, task.id, entry.id].some((id) => l.source.endsWith(`:${id}`)),
    ),
  })
  expect(mine).toEqual(
    expect.arrayContaining([
      `contact:${person.id} -tagged-> ${tag!.id}`,
      `entry:${entry.id} -mentions-> contact:${person.id}`,
      `entry:${entry.id} -references-> task:${task.id}`,
      `task:${task.id} -assigned to-> contact:${person.id}`,
      `task:${task.id} -in project-> project:${project.id}`,
    ]),
  )
})

test("each node's page opens", async ({ request, cleanup }) => {
  const project = await newProject(request, cleanup)
  const person = await newContact(request, cleanup)
  const task = await newTask(request, cleanup, { projectId: project.id, assigneeIds: [person.id] })
  const { entry } = await newEntry(request, cleanup, {
    bodyJson: doc(paragraph(mention(person.id, person.displayName))),
  })
  const g = await graph(request, `?focusId=task:${task.id}&depth=2`)
  const urls = g.nodes.map((n) => n.url).filter((u): u is string => u !== null)
  expect(urls).toEqual(
    expect.arrayContaining([
      `/contacts/${person.slug}`,
      `/projects/${project.slug}`,
      `/board?task=${task.id}`,
      `/notes/${entry.id}`,
    ]),
  )
  for (const url of urls) {
    const page = await request.get(url)
    expect(page.status(), url).toBe(200)
    expect(page.headers()['content-type'], url).toContain('text/html')
  }
})

test('a focus reaches one or two steps, either way along links', async ({ request, cleanup }) => {
  const project = await newProject(request, cleanup)
  const lead = await newContact(request, cleanup)
  const parent = await newTask(request, cleanup, { projectId: project.id })
  const child = await newTask(request, cleanup, { parentTaskId: parent.id, assigneeIds: [lead.id] })

  const near = await graph(request, `?focusId=task:${child.id}&depth=1`)
  expect(near.nodes.map((n) => n.id).sort()).toEqual(
    [`contact:${lead.id}`, `task:${child.id}`, `task:${parent.id}`].sort(),
  )
  expect(linksOf(near)).toEqual(
    [
      `task:${child.id} -assigned to-> contact:${lead.id}`,
      `task:${parent.id} -subtask-> task:${child.id}`,
    ].sort(),
  )

  // Depth 2 is the default, and adds the project through the parent.
  const far = await graph(request, `?focusId=task:${child.id}`)
  expect(far).toEqual(await graph(request, `?focusId=task:${child.id}&depth=2`))
  expect(far.nodes.map((n) => n.id)).toContain(`project:${project.id}`)

  const alone = await newContact(request, cleanup)
  const single = await graph(request, `?focusId=contact:${alone.id}`)
  expect(single.nodes.map((n) => n.id)).toEqual([`contact:${alone.id}`])
  expect(single.links).toEqual([])
})

test('a malformed query is a 400', async ({ request }) => {
  const bad: [string, string | RegExp][] = [
    ['depth=1', 'depth needs a focusId'],
    ['focusId=', /^focusId must be <type>:<id>/],
    ['focusId=contact', /^focusId must be <type>:<id>/],
    ['focusId=widget:abc', /^focusId must be <type>:<id>/],
    ['focusId=contact:a%20b', /^focusId must be <type>:<id>/],
    ['focusId=contact:abc&depth=3', 'depth must be 1 or 2'],
    ['focusId=contact:abc&depth=x', 'depth must be 1 or 2'],
    [
      'focusId=contact:a&focusId=contact:b',
      'focusId was given more than once, with different values',
    ],
    ['focusId=contact:a&depth=1&depth=2', 'depth was given more than once, with different values'],
  ]
  for (const [query, message] of bad)
    await refused(await request.get(`/api/graph?${query}`), 400, message)
})

test('a hidden, missing or mistyped focus is the same 404', async ({ request, cleanup }) => {
  const draft = await newContact(request, cleanup, { isDraft: true })
  const trashed = await newContact(request, cleanup)
  await json(await request.delete(`/api/contacts/${trashed.id}`))
  const visible = await newContact(request, cleanup)

  for (const focusId of [
    `contact:${draft.id}`,
    `contact:${trashed.id}`,
    'contact:no-such-record',
    `project:${visible.id}`,
  ]) {
    await refused(await request.get(`/api/graph?focusId=${focusId}`), 404, 'Not found')
  }

  const whole = await graph(request)
  const ids = new Set(whole.nodes.map((n) => n.id))
  expect(ids.has(`contact:${draft.id}`)).toBe(false)
  expect(ids.has(`contact:${trashed.id}`)).toBe(false)
  expect(ids.has(`contact:${visible.id}`)).toBe(true)
})

test('it is read-only', async ({ request }) => {
  for (const method of ['post', 'put', 'patch', 'delete'] as const) {
    const response = await request[method]('/api/graph', { data: {} })
    expect(response.status(), method).toBe(405)
  }
})
