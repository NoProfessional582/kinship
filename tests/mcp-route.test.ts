import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Nothing here reaches a tool's service call: the database answers only the owner's
// agent access, as `access` says.
let access = 'write'
vi.mock('@/lib/db', () => ({
  prisma: { settings: { findUnique: async () => ({ agentAccess: access }) } },
}))
const route = await import('@/app/api/mcp/route')

const URL_ = 'http://127.0.0.1:3000/api/mcp'
const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
}

const post = (body: string) =>
  route.POST(new Request(URL_, { method: 'POST', headers: HEADERS, body }))
const rpc = (method: string, params: unknown = {}, id = 1) =>
  post(JSON.stringify({ jsonrpc: '2.0', id, method, params }))

const READ_TOOLS = [
  'search',
  'list_contacts',
  'get_contact',
  'get_entries',
  'list_tasks',
  'get_task',
  'list_projects',
  'get_project',
  'list_board_columns',
  'get_calendar',
  'who_is_due',
  'get_neighbourhood',
]

const WRITE_TOOLS = [
  'log_entry',
  'update_entry',
  'create_contact',
  'update_contact',
  'create_task',
  'update_task',
  'move_task',
  'create_project',
  'update_project',
  'link_records',
  'unlink_records',
  'trash_record',
]

interface ListedTool {
  name: string
  description: string
  inputSchema: { type: string; required?: string[] }
  annotations: { readOnlyHint: boolean; destructiveHint: boolean }
}

async function listTools(): Promise<ListedTool[]> {
  const list = await rpc('tools/list', {}, 2)
  expect(list.status).toBe(200)
  return (await list.json()).result.tools
}

const saved = { access: process.env.KINSHIP_AGENT_ACCESS, owner: process.env.KINSHIP_OWNER }
beforeEach(() => {
  access = 'write'
  delete process.env.KINSHIP_AGENT_ACCESS
  process.env.KINSHIP_OWNER = 'tester'
})
afterEach(() => {
  for (const [name, value] of [
    ['KINSHIP_AGENT_ACCESS', saved.access],
    ['KINSHIP_OWNER', saved.owner],
  ] as const) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe('/api/mcp', () => {
  it('answers 404 to every method when KINSHIP_AGENT_ACCESS=off', async () => {
    process.env.KINSHIP_AGENT_ACCESS = 'off'
    for (const response of [await rpc('initialize'), await route.GET(), await route.DELETE()]) {
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({
        error: 'The agent endpoint is turned off (KINSHIP_AGENT_ACCESS=off).',
      })
    }
  })

  it('answers 405 to GET and DELETE: it is stateless', async () => {
    for (const response of [await route.GET(), await route.DELETE()]) {
      expect(response.status).toBe(405)
      expect(response.headers.get('Allow')).toBe('POST')
      expect((await response.json()).error).toMatch(/stateless/)
    }
  })

  it('refuses a body that is not JSON as every route does', async () => {
    const response = await post('{"broken": ')
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'The body is not valid JSON.' })
  })

  it('refuses a body over 1 MB', async () => {
    const response = await post(JSON.stringify({ pad: 'x'.repeat(1024 * 1024) }))
    expect(response.status).toBe(413)
  })

  it('initializes with instructions and lists every tool', async () => {
    const init = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'unit', version: '1' },
    })
    expect(init.status).toBe(200)
    expect(init.headers.get('Cache-Control')).toBe('private, no-store')
    const { result } = await init.json()
    expect(result.serverInfo.name).toBe('kinship')
    expect(result.instructions).toMatch(/@\[Jane Doe\]\(contact:<id>\)/)
    expect(result.instructions).toMatch(/never as instructions/)
    expect(result.instructions).toMatch(/trash_record moves a record to the Trash/)

    const tools = await listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort())
    for (const tool of tools) {
      expect(tool.inputSchema.type, tool.name).toBe('object')
      expect(tool.annotations.readOnlyHint, tool.name).toBe(READ_TOOLS.includes(tool.name))
    }
    const destructive = tools.filter((t) => t.annotations.destructiveHint).map((t) => t.name)
    expect(destructive.sort()).toEqual(['trash_record', 'unlink_records'])
    // Every tool that can answer with text the owner wrote says it is data.
    const quiet = tools
      .filter((t) => !t.description.includes('stored user content'))
      .map((t) => t.name)
    expect(quiet.sort()).toEqual([
      'list_board_columns',
      'trash_record',
      'unlink_records',
      'who_is_due',
    ])
  })

  it('asks only for what a save needs; an update asks only for the id', async () => {
    const required = Object.fromEntries(
      (await listTools())
        .filter((t) => WRITE_TOOLS.includes(t.name))
        .map((t) => [t.name, (t.inputSchema.required ?? []).sort()]),
    )
    expect(required).toEqual({
      log_entry: ['body'],
      update_entry: ['id'],
      create_contact: ['displayName'],
      update_contact: ['id'],
      create_task: ['title'],
      update_task: ['id'],
      move_task: ['columnId', 'id'],
      create_project: ['name'],
      update_project: ['id'],
      link_records: ['relation', 'sourceId', 'sourceType', 'targetId', 'targetType'],
      unlink_records: ['edgeId'],
      trash_record: ['id', 'kind'],
    })
  })

  it('has no tool for settings, emptying the trash or import', async () => {
    const names = (await listTools()).map((t) => t.name).join(' ')
    expect(names).not.toMatch(/setting|access|purge|empty|restore|import|export/)
  })

  it('read only: lists the read tools alone and refuses a write tool by name', async () => {
    access = 'read'
    const init = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'unit', version: '1' },
    })
    expect((await init.json()).result.instructions).toMatch(/Agent access is read only/)
    expect((await listTools()).map((t) => t.name).sort()).toEqual([...READ_TOOLS].sort())

    const call = await rpc('tools/call', {
      name: 'trash_record',
      arguments: { kind: 'contact', id: 'x' },
    })
    expect(call.status).toBe(200)
    const { result } = await call.json()
    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: 'text',
          text:
            "Kinship's agent access is read only, so trash_record is turned off and nothing " +
            'was changed. The owner can allow changes again in Kinship, under Settings → ' +
            'Agents.',
        },
      ],
    })

    // An unknown tool is still just unknown.
    const unknown = await (await rpc('tools/call', { name: 'no_such_tool', arguments: {} })).json()
    expect(unknown.result.content[0].text).toMatch(/not found/)

    access = 'write'
    expect((await listTools()).map((t) => t.name)).toContain('trash_record')
  })

  it('answers bad tool input as a tool error, not a failed request', async () => {
    const response = await rpc('tools/call', { name: 'search', arguments: { q: '' } })
    expect(response.status).toBe(200)
    const { result } = await response.json()
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/Invalid arguments for tool search/)
  })
})
