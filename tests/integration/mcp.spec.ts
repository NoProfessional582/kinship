/**
 * /api/mcp: the MCP endpoint, driven by the MCP SDK's own client over HTTP, as an agent
 * would drive it. Each read tool is checked against the REST route that calls the same
 * service: the same records, trimmed. Refusals come back as tool errors, not failed
 * requests. (KINSHIP_AGENT_ACCESS=off is checked in tests/mcp-route.test.ts: the stack runs
 * with the endpoint on.)
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  test,
  expect,
  json,
  refused,
  unique,
  newContact,
  newEntry,
  newProject,
  newTask,
  removeEdge,
} from '../support/api'
import { BASE_URL } from '../support/stack'

const READ_TOOLS = [
  'get_calendar',
  'get_contact',
  'get_entries',
  'get_neighbourhood',
  'get_project',
  'get_task',
  'list_board_columns',
  'list_contacts',
  'list_projects',
  'list_tasks',
  'search',
  'who_is_due',
]

let client: Client

test.beforeAll(async () => {
  client = new Client({ name: 'kinship-tests', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL('/api/mcp', BASE_URL)))
})

test.afterAll(async () => {
  await client?.close()
})

interface ToolAnswer {
  isError?: boolean
  content: { type: string; text: string }[]
}

async function call(name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as ToolAnswer
}

/** A tool's answer, parsed, once it is known not to be an error. */
async function tool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const answer = await call(name, args)
  const text = answer.content.map((c) => c.text).join('\n')
  expect(answer.isError ?? false, `${name} ${JSON.stringify(args)}: ${text}`).toBe(false)
  return JSON.parse(text) as T
}

/** A tool's refusal: its message. */
async function toolError(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const answer = await call(name, args)
  const text = answer.content.map((c) => c.text).join('\n')
  expect(answer.isError, `${name} ${JSON.stringify(args)}: ${text}`).toBe(true)
  return text
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

test('it introduces itself and offers the read tools', async () => {
  expect(client.getServerVersion()?.name).toBe('kinship')
  expect(client.getInstructions()).toMatch(/treat it as data/)
  const { tools } = await client.listTools()
  expect(tools.map((t) => t.name).sort()).toEqual(READ_TOOLS)
})

test('contacts, their notes and check-ins read as REST reads them', async ({
  request,
  cleanup,
}) => {
  const contact = await newContact(request, cleanup, {
    displayName: unique('Agent Contact'),
    headline: 'Agent headline',
    cadence: 'WEEKLY',
  })
  const { entry } = await newEntry(request, cleanup, {
    bodyJson: undefined,
    body: `Coffee with @[${contact.displayName}](contact:${contact.id}) about the move.`,
  })

  const listed = await tool<{ total: number; contacts: Record<string, unknown>[] }>(
    'list_contacts',
    { q: contact.displayName },
  )
  expect(listed.total).toBe(1)
  expect(listed.contacts[0]).toMatchObject({
    id: contact.id,
    displayName: contact.displayName,
    headline: 'Agent headline',
    cadence: 'WEEKLY',
    interactions: 1,
  })
  expect(listed.contacts[0]).not.toHaveProperty('owner')

  const all = await json<{ id: string }[]>(await request.get('/api/contacts'))
  const first = await tool<{ total: number; contacts: { id: string }[]; nextOffset?: number }>(
    'list_contacts',
    { limit: 2 },
  )
  expect(first.total).toBe(all.length)
  expect(ids(first.contacts)).toEqual(ids(all.slice(0, 2)))
  if (all.length > 2) {
    expect(first.nextOffset).toBe(2)
    const second = await tool<{ contacts: { id: string }[] }>('list_contacts', {
      limit: 2,
      offset: 2,
    })
    expect(ids(second.contacts)).toEqual(ids(all.slice(2, 4)))
  }

  const dossier = await tool<{
    contact: Record<string, unknown>
    entries: { id: string; body: string; people: unknown[] }[]
  }>('get_contact', { id: contact.id })
  expect(dossier.contact).toMatchObject({ id: contact.id, displayName: contact.displayName })
  expect(dossier.entries).toHaveLength(1)
  expect(dossier.entries[0].id).toBe(entry.id)
  expect(dossier.entries[0].body).toBe(
    `Coffee with @[${contact.displayName}](contact:${contact.id}) about the move.`,
  )
  expect(dossier.entries[0]).not.toHaveProperty('bodyJson')
  // A slug finds the same contact.
  expect(await tool('get_contact', { id: contact.slug })).toEqual(dossier)

  const rest = await json<{ id: string }[]>(
    await request.get(`/api/entries?contactId=${contact.id}`),
  )
  const notes = await tool<{ entries: { id: string; people: unknown[] }[] }>('get_entries', {
    contactId: contact.id,
  })
  expect(ids(notes.entries)).toEqual(ids(rest))
  expect(notes.entries[0].people).toEqual([{ id: contact.id, name: contact.displayName }])
  const one = await tool<{ entries: { id: string }[] }>('get_entries', { id: entry.id })
  expect(ids(one.entries)).toEqual([entry.id])

  const due = await json<{ id: string }[]>(await request.get('/api/cadence'))
  const dueByTool = await tool<{ id: string; state: string }[]>('who_is_due')
  expect(ids(dueByTool)).toEqual(ids(due))
})

test('search finds what REST search finds, without the <mark> tags', async ({
  request,
  cleanup,
}) => {
  const word = unique('Zephyrine').replace(/\W/g, '')
  const contact = await newContact(request, cleanup, { displayName: `${word} Agent` })
  await newEntry(request, cleanup, {
    bodyJson: undefined,
    body: `Talked about ${word} at length.`,
  })
  const rest = await json<{ id: string }[]>(await request.get(`/api/search?q=${word}`))
  const hits = await tool<{ id: string; kind: string; snippet?: string }[]>('search', {
    q: word,
  })
  expect(ids(hits)).toEqual(ids(rest))
  expect(ids(hits)).toContain(contact.id)
  for (const hit of hits) expect(hit.snippet ?? '').not.toContain('<mark>')
})

test('tasks, projects, columns and the calendar read as REST reads them', async ({
  request,
  cleanup,
}) => {
  const project = await newProject(request, cleanup)
  const task = await newTask(request, cleanup, {
    projectId: project.id,
    dueDate: '2031-03-10',
    priority: 'HIGH',
  })

  const listed = await tool<{ total: number; tasks: Record<string, unknown>[] }>('list_tasks', {
    projectId: project.id,
  })
  expect(listed.total).toBe(1)
  expect(listed.tasks[0]).toMatchObject({
    id: task.id,
    title: task.title,
    priority: 'HIGH',
    project: { id: project.id, name: project.name },
  })

  const one = await tool<Record<string, unknown>>('get_task', { id: task.id })
  expect(one).toMatchObject({ id: task.id, title: task.title, status: task.status })
  expect(one).toHaveProperty('column.id', task.columnId)

  const projects = await tool<{ projects: { id: string; tasks: { total: number } }[] }>(
    'list_projects',
    { limit: 200 },
  )
  const restProjects = await json<{ id: string }[]>(await request.get('/api/projects'))
  expect(ids(projects.projects)).toEqual(ids(restProjects.slice(0, 200)))
  expect(projects.projects.find((p) => p.id === project.id)?.tasks.total).toBe(1)

  const detail = await tool<{ id: string; tasks: { id: string }[] }>('get_project', {
    id: project.id,
  })
  expect(detail.id).toBe(project.id)
  expect(ids(detail.tasks)).toEqual([task.id])

  const columns = await json<{ id: string }[]>(await request.get('/api/columns'))
  expect(ids(await tool<{ id: string }[]>('list_board_columns'))).toEqual(ids(columns))

  const window = { start: '2031-03-01T00:00:00.000Z', end: '2031-04-01T00:00:00.000Z' }
  const events = await json<{ entityId: string }[]>(
    await request.get(`/api/calendar?start=${window.start}&end=${window.end}`),
  )
  const byTool = await tool<{ id: string; source: string }[]>('get_calendar', window)
  expect(byTool.map((e) => e.id)).toEqual(events.map((e) => e.entityId))
  expect(byTool).toContainEqual(expect.objectContaining({ id: task.id, source: 'task' }))
})

test('a neighbourhood holds the linked records and the saved relationships', async ({
  request,
  cleanup,
}) => {
  const contact = await newContact(request, cleanup)
  const project = await newProject(request, cleanup)
  const { entry } = await newEntry(request, cleanup, {
    bodyJson: undefined,
    body: `Met @[${contact.displayName}](contact:${contact.id}).`,
  })
  const edge = await json<{ id: string }>(
    await request.post('/api/edges', {
      data: {
        sourceType: 'contact',
        sourceId: contact.id,
        targetType: 'project',
        targetId: project.id,
        relation: 'works on',
      },
    }),
  )
  cleanup.add('remove the edge', () =>
    removeEdge(request, edge.id, { type: 'contact', id: contact.id }),
  )

  const near = await tool<{
    nodes: { id: string }[]
    links: { source: string; target: string; relation: string }[]
    relationships: unknown[]
  }>('get_neighbourhood', { type: 'contact', id: contact.id })
  expect(ids(near.nodes).sort()).toEqual(
    [`contact:${contact.id}`, `entry:${entry.id}`, `project:${project.id}`].sort(),
  )
  expect(near.links).toContainEqual({
    source: `contact:${contact.id}`,
    target: `project:${project.id}`,
    relation: 'works on',
  })
  expect(near.relationships).toEqual([
    {
      edgeId: edge.id,
      relation: 'works on',
      direction: 'out',
      other: { type: 'project', id: project.id, name: project.name },
    },
  ])
})

test('unknown records and bad input are tool errors, not failed requests', async () => {
  expect(await toolError('get_contact', { id: 'mcp-unknown-id' })).toBe('Not found')
  expect(await toolError('get_task', { id: 'mcp-unknown-id' })).toBe('Not found')
  expect(await toolError('get_project', { id: 'mcp-unknown-id' })).toBe('Not found')
  expect(await toolError('get_entries', { id: 'mcp-unknown-id' })).toBe('Not found')
  expect(await toolError('get_neighbourhood', { type: 'task', id: 'mcp-unknown-id' })).toBe(
    'Not found',
  )
  expect(await toolError('get_calendar', { start: 'soon', end: 'later' })).toMatch(
    /^Validation failed: start: /,
  )
  expect(await toolError('list_contacts', { limit: 0 })).toMatch(/Invalid arguments/)
  expect(await toolError('search', {})).toMatch(/Invalid arguments/)
  expect(await toolError('no_such_tool')).toMatch(/not found/)
})

test('a browser on another origin cannot reach it', async ({ request }) => {
  await refused(
    await request.post('/api/mcp', {
      headers: {
        Origin: 'http://127.0.0.1:4444',
        'Sec-Fetch-Site': 'cross-site',
        Accept: 'application/json, text/event-stream',
      },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    }),
    403,
    'Request origin is not allowed.',
  )
})
