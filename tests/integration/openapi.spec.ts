/**
 * The API spec (docs/api/kinship.openapi.json) against the running app: GET
 * /api/openapi.json serves it, and every operation's real answers (a success, and its
 * main refusals) are ones the spec documents, with bodies that match its schemas
 * (support/contract.ts). The last test fails when an operation was never seen answering
 * 200, so a route added to the spec needs a call here.
 *
 * POST /api/import answers 200 only by replacing the owner's data, so its success is
 * checked in tests/archive/archive.spec.ts, which runs last.
 */
import { readFileSync } from 'node:fs'
import {
  doc,
  json,
  mention,
  paragraph,
  test,
  expect,
  text,
  unique,
  type Cleanup,
  FROM_THE_APP,
} from '../support/api'
import { conforms, operations, seen, spec, SPEC_FILE, type Method } from '../support/contract'
import { BASE_URL } from '../support/stack'
import type { APIRequestContext } from '@playwright/test'

// In order, stopping at the first failure: the last test reads what the others saw, and
// Playwright starts a new worker (with nothing seen) after a failure.
test.describe.configure({ mode: 'serial' })

/** An id no record has. */
const UNKNOWN = 'contract-unknown-id'

/** Calls `method specPath` with `{name}` filled in, and checks the answer against the spec. */
async function call<T = unknown>(
  api: APIRequestContext,
  method: Method,
  specPath: string,
  options: {
    params?: Record<string, string>
    query?: string
    data?: unknown
    headers?: Record<string, string>
    multipart?: Record<string, { name: string; mimeType: string; buffer: Buffer }>
  } = {},
): Promise<{ status: number; body: T }> {
  const url =
    specPath.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(options.params![name])) +
    (options.query ? `?${options.query}` : '')
  const answer = await api.fetch(url, {
    method: method.toUpperCase(),
    data: options.data,
    headers: options.headers,
    multipart: options.multipart,
  })
  return { status: answer.status(), body: await conforms<T>(answer, method, specPath) }
}

/** A call that must answer 200. */
async function ok<T = unknown>(...args: Parameters<typeof call>): Promise<T> {
  const { status, body } = await call<T>(...args)
  expect(status, `${args[1].toUpperCase()} ${args[2]}`).toBe(200)
  return body
}

/** A call that must be refused with `status`, as `{ error }`. */
async function refusedWith(status: number, ...args: Parameters<typeof call>) {
  const answer = await call<{ error: string }>(...args)
  expect(answer.status, `${args[1].toUpperCase()} ${args[2]}`).toBe(status)
  expect(typeof answer.body.error).toBe('string')
  return answer.body.error
}

interface Made {
  id: string
}

async function contact(api: APIRequestContext, cleanup: Cleanup, fields = {}) {
  const made = await ok<Made>(api, 'post', '/api/contacts', {
    data: { displayName: unique('Contract contact'), ...fields },
  })
  cleanup.record('contact', made.id)
  return made
}

async function project(api: APIRequestContext, cleanup: Cleanup) {
  const made = await ok<Made>(api, 'post', '/api/projects', {
    data: { name: unique('Contract project') },
  })
  cleanup.record('project', made.id)
  return made
}

async function task(api: APIRequestContext, cleanup: Cleanup, fields = {}) {
  const made = await ok<Made & { columnId: string }>(api, 'post', '/api/tasks', {
    data: { title: unique('Contract task'), ...fields },
  })
  cleanup.record('task', made.id)
  return made
}

test('GET /api/openapi.json serves the committed spec', async ({ request }) => {
  const served = await ok<typeof spec>(request, 'get', '/api/openapi.json')
  expect(served).toEqual(JSON.parse(readFileSync(SPEC_FILE, 'utf8')))
  expect(served.info.version).toMatch(/^\d+\.\d+\.\d+$/)
})

test('System: health', async ({ request }) => {
  expect(await ok(request, 'get', '/api/health')).toEqual({ ok: true })
})

test('Contacts: create, read, list, update, attributes, cadence, delete', async ({
  request,
  cleanup,
}) => {
  const name = unique('Contract contact')
  const made = await contact(request, cleanup, { displayName: name, cadence: 'MONTHLY' })
  const params = { id: made.id }
  await ok(request, 'get', '/api/contacts/{id}', { params })
  const listed = await ok<Made[]>(request, 'get', '/api/contacts', {
    query: `q=${encodeURIComponent(name)}`,
  })
  expect(listed.map((c) => c.id)).toEqual([made.id])
  // An update sends the whole record.
  await ok(request, 'patch', '/api/contacts/{id}', {
    params,
    data: { displayName: name, headline: 'Contract', cadence: 'MONTHLY' },
  })
  await ok(request, 'put', '/api/contacts/{id}/attributes', {
    params,
    data: { attributes: [{ category: 'Work', key: 'Team', value: 'Contracts' }] },
  })
  expect(
    await ok<unknown[]>(request, 'get', '/api/contacts/{id}/attributes', { params }),
  ).toHaveLength(1)
  const due = await ok<Made[]>(request, 'get', '/api/cadence')
  expect(due.map((c) => c.id)).toContain(made.id)
  await ok(request, 'delete', '/api/contacts/{id}', { params })

  const missing = { params: { id: UNKNOWN } }
  await refusedWith(404, request, 'get', '/api/contacts/{id}', missing)
  await refusedWith(404, request, 'get', '/api/contacts/{id}/attributes', missing)
  await refusedWith(400, request, 'post', '/api/contacts', { data: { displayName: '' } })
})

test('Entries: create with a mention, read, list, update, delete', async ({ request, cleanup }) => {
  const person = await contact(request, cleanup)
  const saved = await ok<{ entry: Made; createdEntities: { type: 'contact'; id: string }[] }>(
    request,
    'post',
    '/api/entries',
    {
      data: {
        kind: 'CALL',
        title: unique('Contract note'),
        bodyJson: doc(paragraph(text('Called '), mention(person.id, 'them'))),
      },
    },
  )
  cleanup.record('entry', saved.entry.id)
  const params = { id: saved.entry.id }
  await ok(request, 'get', '/api/entries/{id}', { params })
  const listed = await ok<Made[]>(request, 'get', '/api/entries', {
    query: `contactId=${person.id}`,
  })
  expect(listed.map((e) => e.id)).toEqual([saved.entry.id])
  await ok(request, 'patch', '/api/entries/{id}', { params, data: { title: unique('Renamed') } })
  await ok(request, 'delete', '/api/entries/{id}', { params })

  await refusedWith(404, request, 'get', '/api/entries/{id}', { params: { id: UNKNOWN } })
  await refusedWith(400, request, 'get', '/api/entries', { query: 'take=0' })
})

test('Entries: a plain-text body in, the same body out', async ({ request, cleanup }) => {
  const person = await contact(request, cleanup)
  const taskLabel = unique('Contract body task')
  const body = `Called @[Them](contact:${person.id})\n\n- follow up on [[${taskLabel}]](task:new)`
  const saved = await ok<{
    entry: Made & { body: string }
    createdEntities: { type: string; id: string }[]
  }>(request, 'post', '/api/entries', { data: { kind: 'CALL', body } })
  cleanup.record('entry', saved.entry.id)
  const made = saved.createdEntities.find((c) => c.type === 'task')!
  cleanup.record('task', made.id)
  const stored = body.replace('(task:new)', `(task:${made.id})`)
  expect(saved.entry.body).toBe(stored)

  const params = { id: saved.entry.id }
  const read = await ok<{ body: string }>(request, 'get', '/api/entries/{id}', { params })
  expect(read.body).toBe(stored)
  const edited = await ok<{ entry: { body: string } }>(request, 'patch', '/api/entries/{id}', {
    params,
    data: { body: read.body + '\n\nAnd one more line.' },
  })
  expect(edited.entry.body).toBe(stored + '\n\nAnd one more line.')

  const both = { body, bodyJson: doc(paragraph(text('x'))) }
  expect(await refusedWith(400, request, 'post', '/api/entries', { data: both })).toBe(
    'Validation failed',
  )
  await refusedWith(400, request, 'patch', '/api/entries/{id}', { params, data: both })
  await refusedWith(400, request, 'post', '/api/entries', { data: { title: 'No body' } })
  const ghost = { body: `Met @[Nobody](contact:${UNKNOWN})` }
  expect(await refusedWith(400, request, 'post', '/api/entries', { data: ghost })).toContain(
    `contact:${UNKNOWN}`,
  )
  await refusedWith(400, request, 'patch', '/api/entries/{id}', { params, data: ghost })

  // The trash answers with the entry too.
  await ok(request, 'delete', '/api/entries/{id}', { params })
  const restored = await ok<{ body: string }>(request, 'post', '/api/trash', {
    data: { action: 'restore', kind: 'entry', id: saved.entry.id },
  })
  expect(restored.body).toBe(edited.entry.body)
})

test('Tasks: create, read, board, update, move, drafts, delete', async ({ request, cleanup }) => {
  const made = await task(request, cleanup)
  const params = { id: made.id }
  await ok(request, 'get', '/api/tasks/{id}', { params })
  const board = await ok<{ columns: { id: string }[] }>(request, 'get', '/api/tasks')
  await ok(request, 'patch', '/api/tasks/{id}', {
    params,
    data: { title: unique('Contract task'), priority: 'HIGH', columnId: made.columnId },
  })
  const target = board.columns.find((c) => c.id !== made.columnId) ?? board.columns[0]
  await ok(request, 'patch', '/api/tasks/{id}/move', {
    params,
    data: { columnId: target.id, toIndex: 0 },
  })
  await ok(request, 'get', '/api/drafts')
  await ok(request, 'delete', '/api/tasks/{id}', { params })

  await refusedWith(404, request, 'get', '/api/tasks/{id}', { params: { id: UNKNOWN } })
  await refusedWith(400, request, 'post', '/api/tasks', { data: { title: '' } })
})

test('Columns: create, update, reorder, delete', async ({ request, cleanup }) => {
  const before = await ok<Made[]>(request, 'get', '/api/columns')
  const made = await ok<Made>(request, 'post', '/api/columns', {
    data: { name: unique('Contract column') },
  })
  cleanup.column(made.id)
  const params = { id: made.id }
  await ok(request, 'patch', '/api/columns/{id}', { params, data: { wipLimit: 3 } })
  const ids = [made.id, ...before.map((c) => c.id)]
  await ok(request, 'patch', '/api/columns/reorder', { data: { columnIds: ids } })
  await ok(request, 'patch', '/api/columns/reorder', {
    data: { columnIds: [...before.map((c) => c.id), made.id] },
  })
  await ok(request, 'delete', '/api/columns/{id}', { params })

  await refusedWith(404, request, 'patch', '/api/columns/{id}', {
    params: { id: UNKNOWN },
    data: { name: 'x' },
  })
})

test('Projects: create, read, list, update, delete', async ({ request, cleanup }) => {
  const made = await project(request, cleanup)
  const params = { id: made.id }
  await ok(request, 'get', '/api/projects/{id}', { params })
  const listed = await ok<Made[]>(request, 'get', '/api/projects')
  expect(listed.map((p) => p.id)).toContain(made.id)
  await ok(request, 'patch', '/api/projects/{id}', {
    params,
    data: { name: unique('Contract project'), status: 'IN_PROGRESS' },
  })
  await ok(request, 'delete', '/api/projects/{id}', { params })

  await refusedWith(404, request, 'get', '/api/projects/{id}', { params: { id: UNKNOWN } })
})

test('Edges: relate two contacts, list, delete', async ({ request, cleanup }) => {
  const a = await contact(request, cleanup)
  const b = await contact(request, cleanup)
  const edge = await ok<Made>(request, 'post', '/api/edges', {
    data: {
      sourceType: 'contact',
      sourceId: a.id,
      targetType: 'contact',
      targetId: b.id,
      relation: 'mentors',
    },
  })
  const listed = await ok<Made[]>(request, 'get', '/api/edges', {
    query: `type=contact&id=${a.id}`,
  })
  expect(listed.map((e) => e.id)).toEqual([edge.id])
  await ok(request, 'delete', '/api/edges/{id}', { params: { id: edge.id } })

  await refusedWith(400, request, 'post', '/api/edges', {
    data: {
      sourceType: 'contact',
      sourceId: a.id,
      targetType: 'contact',
      targetId: a.id,
      relation: 'self',
    },
  })
})

test('Calendar: the feed, and moving a task deadline', async ({ request, cleanup }) => {
  // March 2032: a month no other test uses.
  const made = await task(request, cleanup, { dueDate: '2032-03-10' })
  const feed = await ok<{ id: string }[]>(request, 'get', '/api/calendar', {
    query: 'start=2032-03-01&end=2032-04-01',
  })
  expect(feed.length).toBeGreaterThan(0)
  await ok(request, 'patch', '/api/calendar', {
    data: { source: 'task', entityId: made.id, start: '2032-03-12' },
  })
  await refusedWith(400, request, 'get', '/api/calendar')
})

test('Search: everything, and mention suggestions', async ({ request, cleanup }) => {
  const name = unique('Contract searchable')
  const made = await contact(request, cleanup, { displayName: name })
  const hits = await ok<{ id: string }[]>(request, 'get', '/api/search', {
    query: `q=${encodeURIComponent(name)}`,
  })
  expect(hits.map((h) => h.id)).toContain(made.id)
  await ok(request, 'get', '/api/search/mentions', {
    query: `type=contact&q=${encodeURIComponent(name)}`,
  })
  await ok(request, 'get', '/api/search/mentions', { query: 'type=entity&q=Contract' })
  await refusedWith(400, request, 'get', '/api/search/mentions', { query: 'type=nothing' })
})

test('Trash: list, restore, purge', async ({ request, cleanup }) => {
  const made = await contact(request, cleanup)
  await ok(request, 'delete', '/api/contacts/{id}', { params: { id: made.id } })
  const trash = await ok<{ contacts: Made[] }>(request, 'get', '/api/trash')
  expect(trash.contacts.map((c) => c.id)).toContain(made.id)
  await ok(request, 'post', '/api/trash', {
    data: { action: 'restore', kind: 'contact', id: made.id },
  })
  await ok(request, 'delete', '/api/contacts/{id}', { params: { id: made.id } })
  await ok(request, 'post', '/api/trash', {
    data: { action: 'purge', kind: 'contact', id: made.id },
  })
  await refusedWith(400, request, 'post', '/api/trash', { data: { action: 'restore' } })
})

test('Settings: read, change and change back; weather stays off', async ({ request, cleanup }) => {
  const settings = await ok<{ tagline: string }>(request, 'get', '/api/settings')
  cleanup.add('restore the tagline', async () =>
    json(await request.patch('/api/settings', { data: { tagline: settings.tagline } })),
  )
  await ok(request, 'patch', '/api/settings', { data: { tagline: unique('Contract tagline') } })
  expect(await ok(request, 'get', '/api/weather')).toEqual({ enabled: false })
  await refusedWith(400, request, 'patch', '/api/settings', { data: { fontScale: 9 } })
  await refusedWith(400, request, 'patch', '/api/settings', { data: { agentAccess: 'admin' } })
})

test('System: the desktop app manifest', async ({ request }) => {
  const manifest = JSON.parse(
    (await ok<Buffer>(request, 'get', '/desktop.webmanifest')).toString(),
  ) as { start_url: string }
  expect(manifest.start_url).toBe('/')
})

test('Files: export', async ({ request }) => {
  const archive = await ok<{ format: string }>(request, 'get', '/api/export')
  expect(archive.format).toBe('kb-archive')
  // Without confirm=replace nothing is read or changed.
  await refusedWith(400, request, 'post', '/api/import', { data: archive })
})

test('Agents: the MCP endpoint answers POST, and only POST', async ({ request }) => {
  const headers = { Accept: 'application/json, text/event-stream' }
  const init = await ok<{ result: { serverInfo: { name: string } } }>(request, 'post', '/api/mcp', {
    headers,
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'contract', version: '1' },
      },
    },
  })
  expect(init.result.serverInfo.name).toBe('kinship')
  await refusedWith(405, request, 'get', '/api/mcp', { headers })
  await refusedWith(405, request, 'delete', '/api/mcp', { headers })
})

test('Agents: read-only access hides the write tools, and switching back restores them', async ({
  request,
  cleanup,
}) => {
  const headers = { Accept: 'application/json, text/event-stream' }
  const toolNames = async () => {
    const listed = await ok<{ result: { tools: { name: string }[] } }>(
      request,
      'post',
      '/api/mcp',
      { headers, data: { jsonrpc: '2.0', id: 2, method: 'tools/list' } },
    )
    return listed.result.tools.map((t) => t.name)
  }
  const settings = await ok<{ agentAccess: string }>(request, 'get', '/api/settings')
  expect(settings.agentAccess).toBe('write')
  cleanup.add('restore agent access', async () =>
    json(
      await request.patch('/api/settings', {
        data: { agentAccess: settings.agentAccess },
        headers: FROM_THE_APP,
      }),
    ),
  )
  expect(await toolNames()).toEqual(expect.arrayContaining(['search', 'log_entry']))

  const read = await ok<{ agentAccess: string }>(request, 'patch', '/api/settings', {
    data: { agentAccess: 'read' },
    headers: FROM_THE_APP,
  })
  expect(read.agentAccess).toBe('read')
  const readOnly = await toolNames()
  expect(readOnly).toContain('search')
  expect(readOnly).not.toContain('log_entry')

  await ok(request, 'patch', '/api/settings', {
    data: { agentAccess: 'write' },
    headers: FROM_THE_APP,
  })
  expect(await toolNames()).toContain('log_entry')
})

test('Graph: the whole map', async ({ request }) => {
  await ok(request, 'get', '/api/graph')
})

test('every JSON body refuses broken JSON (400) and other media types (415)', async ({
  request,
}) => {
  for (const { method, path, op } of operations) {
    if (!op.requestBody?.content['application/json']) continue
    const params = { id: UNKNOWN }
    // confirm=replace, so the import reaches the body (and refuses it: nothing changes).
    const query = path === '/api/import' ? 'confirm=replace' : undefined
    const broken = await refusedWith(400, request, method, path, {
      params,
      query,
      headers: { 'Content-Type': 'application/json' },
      // Bytes: Playwright sends a string that is not JSON as a JSON string, which parses.
      data: Buffer.from('{"broken": '),
    })
    expect(broken).toMatch(/not (valid )?JSON/)
    await refusedWith(415, request, method, path, {
      params,
      query,
      headers: { 'Content-Type': 'text/plain' },
      data: '{}',
    })
  }
})

test('a foreign Origin is refused (403), as the spec says of every route', async ({ request }) => {
  await refusedWith(403, request, 'post', '/api/contacts', {
    headers: { Origin: 'http://127.0.0.1:4444' },
    data: { displayName: 'Refused contact' },
  })
  expect(new URL(BASE_URL).origin).not.toBe('http://127.0.0.1:4444')
})

test('every operation in the spec was seen answering 200', () => {
  const never = operations
    .filter(({ op }) => op.operationId !== 'importArchive' && '200' in op.responses)
    .map(({ method, path }) => `${method.toUpperCase()} ${path}`)
    .filter((op) => !seen.has(`${op} 200`))
  expect(never).toEqual([])
})
