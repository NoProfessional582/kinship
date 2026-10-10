/** /api/trash: what was deleted, putting it back, and deleting it for good. */
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
  doc,
  paragraph,
  mention,
  type Contact,
  type TrashKind,
  type TrashList,
} from '../support/api'
import type { APIRequestContext } from '@playwright/test'

const ROUTE: Record<TrashKind, string> = {
  contact: '/api/contacts',
  entry: '/api/entries',
  task: '/api/tasks',
  project: '/api/projects',
}

const trash = async (request: APIRequestContext) => json<TrashList>(await request.get('/api/trash'))

const act = (request: APIRequestContext, data: Record<string, unknown>) =>
  request.post('/api/trash', { data })

/** One of each kind, made and then deleted. */
async function trashed(request: APIRequestContext, cleanup: Parameters<typeof newContact>[1]) {
  const ids: Record<TrashKind, string> = {
    contact: (await newContact(request, cleanup)).id,
    entry: (await newEntry(request, cleanup)).entry.id,
    task: (await newTask(request, cleanup)).id,
    project: (await newProject(request, cleanup)).id,
  }
  for (const kind of Object.keys(ids) as TrashKind[]) {
    await json(await request.delete(`${ROUTE[kind]}/${ids[kind]}`))
  }
  return ids
}

test('deleted records are listed, and restoring brings each back', async ({ request, cleanup }) => {
  const ids = await trashed(request, cleanup)
  const listed = await trash(request)
  expect(listed.contacts.map((r) => r.id)).toContain(ids.contact)
  expect(listed.entries.map((r) => r.id)).toContain(ids.entry)
  expect(listed.tasks.map((r) => r.id)).toContain(ids.task)
  expect(listed.projects.map((r) => r.id)).toContain(ids.project)
  expect(listed.total).toBeGreaterThanOrEqual(4)

  for (const kind of Object.keys(ids) as TrashKind[]) {
    await refused(await request.get(`${ROUTE[kind]}/${ids[kind]}`), 404, 'Not found')
    await json(await act(request, { action: 'restore', kind, id: ids[kind] }))
    const read = await json<{ id?: string; contact?: { id: string } }>(
      await request.get(`${ROUTE[kind]}/${ids[kind]}`),
    )
    expect(read.contact?.id ?? read.id).toBe(ids[kind])
  }
  const after = await trash(request)
  expect(after.total).toBe(listed.total - 4)
})

test('restoring a note gives its people back their last contact', async ({ request, cleanup }) => {
  const contact = await newContact(request, cleanup)
  const { entry } = await newEntry(request, cleanup, {
    occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
    bodyJson: doc(paragraph(mention(contact.id, contact.displayName))),
  })
  const lastContact = async () =>
    (await json<{ contact: Contact }>(await request.get(`/api/contacts/${contact.id}`))).contact
      .lastContactAt

  await json(await request.delete(`/api/entries/${entry.id}`))
  expect(await lastContact()).toBeNull()
  await json(await act(request, { action: 'restore', kind: 'entry', id: entry.id }))
  expect(await lastContact()).toBe(entry.occurredAt)
})

test('purging deletes for good, once', async ({ request, cleanup }) => {
  const ids = await trashed(request, cleanup)
  const listed = await trash(request)
  const deletedAt = listed.tasks.find((t) => t.id === ids.task)!.deletedAt

  await json(await act(request, { action: 'purge', kind: 'task', id: ids.task, deletedAt }))
  expect((await trash(request)).tasks.map((t) => t.id)).not.toContain(ids.task)
  await refused(
    await act(request, { action: 'purge', kind: 'task', id: ids.task }),
    409,
    'That item no longer exists. Reload the trash.',
  )
})

test('a purge refuses what is not in the trash, or was trashed again since', async ({
  request,
  cleanup,
}) => {
  const contact = await newContact(request, cleanup)
  await refused(
    await act(request, { action: 'purge', kind: 'contact', id: contact.id }),
    409,
    'That item is not in the trash — it may have been restored in another tab. ' +
      'Only trashed items can be deleted permanently.',
  )

  await json(await request.delete(`/api/contacts/${contact.id}`))
  const seen = (await trash(request)).contacts.find((c) => c.id === contact.id)!.deletedAt
  await json(await act(request, { action: 'restore', kind: 'contact', id: contact.id }))
  await json(await request.delete(`/api/contacts/${contact.id}`))
  await refused(
    await act(request, { action: 'purge', kind: 'contact', id: contact.id, deletedAt: seen }),
    409,
    'That item was restored and trashed again since this view loaded. ' +
      'Reload the trash and try again.',
  )
})

test('a task whose subtask is still live is not purged, nor is the trash emptied', async ({
  request,
  cleanup,
}) => {
  const parent = await newTask(request, cleanup)
  const child = await newTask(request, cleanup, { parentTaskId: parent.id })
  await json(await request.delete(`/api/tasks/${parent.id}`))

  await refused(
    await act(request, { action: 'purge', kind: 'task', id: parent.id }),
    409,
    `This task still has 1 subtask that is not in the trash ("${child.title}"). Deleting it ` +
      'permanently would delete it too. Move it to the trash first, or reparent it.',
  )
  await refused(
    await act(request, { action: 'empty' }),
    409,
    `Emptying the trash would permanently delete 1 subtask that is not in the trash ` +
      `("${child.title}"), because their parent task is. Move them to the trash first, or ` +
      'reparent them.',
  )
  // Put the parent back, so the trash can be emptied by the next test.
  await json(await act(request, { action: 'restore', kind: 'task', id: parent.id }))
})

test('emptying the trash deletes everything in it', async ({ request, cleanup }) => {
  await trashed(request, cleanup)
  const before = await trash(request)
  const emptied = await json<Record<string, number>>(await act(request, { action: 'empty' }))
  expect(emptied).toEqual({
    contacts: before.contacts.length,
    entries: before.entries.length,
    tasks: before.tasks.length,
    projects: before.projects.length,
  })
  expect(await trash(request)).toEqual({
    contacts: [],
    entries: [],
    tasks: [],
    projects: [],
    total: 0,
  })
})

test.describe('refusals', () => {
  test('an action must be known, and restore and purge need a kind and an id', async ({
    request,
  }) => {
    await invalid(await act(request, { action: 'shred' }), 'action')
    await refused(await act(request, { action: 'restore' }), 400, 'kind and id are required')
    await refused(
      await act(request, { action: 'purge', kind: 'task' }),
      400,
      'kind and id are required',
    )
    await invalid(await act(request, { action: 'restore', kind: 'tag', id: 'x' }), 'kind')
    await invalid(
      await act(request, { action: 'purge', kind: 'task', id: 'x', deletedAt: 'yesterday' }),
      'deletedAt',
    )
  })

  test('restoring an unknown record is not found', async ({ request }) => {
    for (const kind of ['contact', 'entry', 'task', 'project']) {
      await refused(
        await act(request, { action: 'restore', kind, id: `no-such-${kind}` }),
        404,
        'Not found',
      )
    }
  })
})
