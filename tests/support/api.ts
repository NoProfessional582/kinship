/**
 * What the API tests (tests/integration) and the browser flows share for checking answers
 * and for making and removing their own records through the API.
 *
 * Test data: there is one owner and one database for everything, so every test makes what
 * it needs under a name no other run or record uses (`unique`), never assumes a table is
 * empty, and removes what it made: `cleanup` runs the removals after the test, pass or
 * fail. Removals look before they delete, so cleaning up never causes a refusal the stack's
 * logs would show (scripts/test-stack.sh allows only the ones tests cause on purpose).
 *
 * Imports nothing from the app (support/stack.ts says why).
 */
import { test as base, expect, type APIRequestContext, type APIResponse } from '@playwright/test'

/** This run's id: names made with it never collide with an earlier run's or the seed's. */
export const RUN = Date.now().toString(36)

let made = 0

/** A name nothing else has: the label, this run's id and a counter. */
export const unique = (label: string) => `${label} ${RUN}-${++made}`

/** A JSON answer's body, once its status is checked (the body is shown if it is not). */
export async function json<T>(response: APIResponse, status = 200): Promise<T> {
  const request = `${response.url()} answered ${response.status()}: ${await response.text()}`
  expect(response.status(), request).toBe(status)
  expect(response.headers()['content-type'], request).toContain('application/json')
  return (await response.json()) as T
}

/** A refusal: the status, and `{ "error": message }` as JSON. */
export async function refused(response: APIResponse, status: number, message: string | RegExp) {
  const body = await json<{ error: string }>(response, status)
  if (typeof message === 'string') expect(body.error).toBe(message)
  else expect(body.error).toMatch(message)
}

interface Issue {
  path: (string | number)[]
  message: string
}

/** Zod's refusal: 400, "Validation failed", and an issue on `field` (dotted path). */
export async function invalid(response: APIResponse, field: string, message?: string | RegExp) {
  const body = await json<{ error: string; issues: Issue[] }>(response, 400)
  expect(body.error).toBe('Validation failed')
  const issue = body.issues.find((i) => i.path.join('.') === field)
  expect(issue, `an issue on "${field}" among ${JSON.stringify(body.issues)}`).toBeTruthy()
  if (typeof message === 'string') expect(issue!.message).toBe(message)
  else if (message) expect(issue!.message).toMatch(message)
}

/** The four kinds of record that go to the trash, and where the API keeps each. */
export type TrashKind = 'contact' | 'entry' | 'task' | 'project'

const ROUTE: Record<TrashKind, string> = {
  contact: '/api/contacts',
  entry: '/api/entries',
  task: '/api/tasks',
  project: '/api/projects',
}

const TRASH_SECTION = {
  contact: 'contacts',
  entry: 'entries',
  task: 'tasks',
  project: 'projects',
} as const

export interface TrashList {
  contacts: { id: string; displayName: string; deletedAt: string }[]
  entries: { id: string; title: string | null; deletedAt: string }[]
  tasks: { id: string; title: string; deletedAt: string }[]
  projects: { id: string; name: string; deletedAt: string }[]
  total: number
}

/**
 * Removes a record for good, wherever it is now: live (trashed, then purged), in the trash
 * (purged), or already gone (nothing to do).
 */
export async function removeRecord(api: APIRequestContext, kind: TrashKind, id: string) {
  // Live, it reads; trashed or gone, it is not found.
  const read = await api.get(`${ROUTE[kind]}/${id}`)
  if (read.status() === 200) await json(await api.delete(`${ROUTE[kind]}/${id}`))
  else await refused(read, 404, 'Not found')
  const trash = await json<TrashList>(await api.get('/api/trash'))
  if (trash[TRASH_SECTION[kind]].some((row) => row.id === id)) {
    await json(await api.post('/api/trash', { data: { action: 'purge', kind, id } }))
  }
}

/** Removes a board column, if it is still there (its cards must be gone first). */
export async function removeColumn(api: APIRequestContext, id: string) {
  const columns = await json<{ id: string }[]>(await api.get('/api/columns'))
  if (columns.some((c) => c.id === id)) await json(await api.delete(`/api/columns/${id}`))
}

/** Removes a relationship, if it is still there; `from` is either end. */
export async function removeEdge(
  api: APIRequestContext,
  id: string,
  from: { type: string; id: string },
) {
  const edges = await json<{ id: string }[]>(
    await api.get(`/api/edges?type=${from.type}&id=${from.id}`),
  )
  if (edges.some((e) => e.id === id)) await json(await api.delete(`/api/edges/${id}`))
}

export interface Cleanup {
  /** Runs `undo` after the test, pass or fail; the last added runs first. */
  add(label: string, undo: () => Promise<unknown>): void
  /** Removes this record for good after the test (`removeRecord`). */
  record(kind: TrashKind, id: string): void
  /** Removes this column after the test (`removeColumn`). */
  column(id: string): void
}

/** The `cleanup` fixture's body, shared by the API and browser `test`s. */
export async function withCleanup(api: APIRequestContext, run: (c: Cleanup) => Promise<void>) {
  const undo: [string, () => Promise<unknown>][] = []
  const add = (label: string, fn: () => Promise<unknown>) => void undo.push([label, fn])
  await run({
    add,
    record: (kind, id) => add(`remove ${kind} ${id}`, () => removeRecord(api, kind, id)),
    column: (id) => add(`remove column ${id}`, () => removeColumn(api, id)),
  })
  const failed: string[] = []
  for (const [label, fn] of undo.reverse()) {
    try {
      await fn()
    } catch (error) {
      failed.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  expect(failed, 'cleaning up after the test').toEqual([])
}

/** The API tests' `test`: Playwright's, with `cleanup`. */
export const test = base.extend<{ cleanup: Cleanup }>({
  cleanup: async ({ request }, use) => withCleanup(request, use),
})

export { expect }

// ------------------------------------------------------------------- Records

/** The fields of the records the tests read; the API sends more. */
export interface Contact {
  id: string
  slug: string
  owner: string
  displayName: string
  headline: string | null
  avatarUrl: string | null
  isDraft: boolean
  cadence: string
  lastContactAt: string | null
  attributes?: { category: string; key: string; value: string; position: number }[]
}

export interface Project {
  id: string
  slug: string
  owner: string
  name: string
  status: string
  startDate: string | null
  targetDate: string | null
}

export interface Task {
  id: string
  slug: string
  owner: string
  title: string
  status: string
  priority: string
  columnId: string
  position: number
  projectId: string | null
  parentTaskId: string | null
  dueDate: string | null
  startDate: string | null
  completedAt: string | null
  subtasks: { id: string; title: string }[]
  assignees: { contact: { id: string } }[]
  tags: { tag: { name: string } }[]
}

export interface Entry {
  id: string
  owner: string
  kind: string
  title: string | null
  bodyText: string
  occurredAt: string
  durationMin: number | null
  mentions: { contact: { id: string; displayName: string } }[]
  refs: { task: { id: string } | null; project: { id: string } | null }[]
  tags: { tag: { name: string } }[]
}

export interface Column {
  id: string
  name: string
  status: string
  position: number
  wipLimit: number | null
  color: string | null
}

/** A new contact, removed after the test. */
export async function newContact(
  api: APIRequestContext,
  cleanup: Cleanup,
  fields: Record<string, unknown> = {},
) {
  const data = { displayName: unique('Contact'), ...fields }
  const contact = await json<Contact>(await api.post('/api/contacts', { data }))
  cleanup.record('contact', contact.id)
  return contact
}

/** A new project, removed after the test. */
export async function newProject(
  api: APIRequestContext,
  cleanup: Cleanup,
  fields: Record<string, unknown> = {},
) {
  const data = { name: unique('Project'), ...fields }
  const project = await json<Project>(await api.post('/api/projects', { data }))
  cleanup.record('project', project.id)
  return project
}

/** A new task, removed after the test. */
export async function newTask(
  api: APIRequestContext,
  cleanup: Cleanup,
  fields: Record<string, unknown> = {},
) {
  const data = { title: unique('Task'), ...fields }
  const task = await json<Task>(await api.post('/api/tasks', { data }))
  cleanup.record('task', task.id)
  return task
}

/** A new note (an entry), removed after the test, with the records it made inline. */
export async function newEntry(
  api: APIRequestContext,
  cleanup: Cleanup,
  fields: Record<string, unknown> = {},
) {
  const data = { title: unique('Note'), bodyJson: doc(paragraph(text('A note.'))), ...fields }
  const saved = await json<{ entry: Entry; createdEntities: { type: TrashKind; id: string }[] }>(
    await api.post('/api/entries', { data }),
  )
  for (const made of saved.createdEntities) cleanup.record(made.type, made.id)
  cleanup.record('entry', saved.entry.id)
  return saved
}

/** A new board column, removed after the test (after the tasks made later). */
export async function newColumn(
  api: APIRequestContext,
  cleanup: Cleanup,
  fields: Record<string, unknown> = {},
) {
  const data = { name: unique('Column'), ...fields }
  const column = await json<Column>(await api.post('/api/columns', { data }))
  cleanup.column(column.id)
  return column
}

// ------------------------------------------------------- A note's body (TipTap)

// The node names are the editor's (lib/tiptap/nodes.ts: CONTACT_MENTION, ENTITY_REF).
type Node = { type: string; text?: string; attrs?: Record<string, string>; content?: Node[] }

export const doc = (...content: Node[]): Node => ({ type: 'doc', content })
export const paragraph = (...content: Node[]): Node => ({ type: 'paragraph', content })
export const text = (value: string): Node => ({ type: 'text', text: value })
/** An @mention of a contact; an id starting `new:` asks the save to create the contact. */
export const mention = (id: string, label: string): Node => ({
  type: 'contactMention',
  attrs: { id, label },
})
/** A [[reference]] to a task or project; `new:` ids are created as for mentions. */
export const reference = (kind: 'task' | 'project', id: string, label: string): Node => ({
  type: 'entityRef',
  attrs: { id, kind, label },
})
