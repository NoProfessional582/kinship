/**
 * /api/entries and /api/entries/[id] (notes and other communications), and /api/drafts:
 * the contacts, tasks and projects a note created inline that still need details.
 */
import {
  test,
  expect,
  json,
  refused,
  invalid,
  unique,
  newContact,
  newEntry,
  doc,
  paragraph,
  text,
  mention,
  reference,
  type Contact,
  type Entry,
} from '../support/api'

interface FollowUpLink {
  id: string
  title: string | null
  written: boolean
}

type Listed = Entry & { followUp: FollowUpLink | null; followsUp: FollowUpLink | null }

const UNKNOWN = 'no-such-entry'
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString()
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

const lastContactOf = async (request: Parameters<typeof newContact>[0], id: string) =>
  (await json<{ contact: Contact }>(await request.get(`/api/contacts/${id}`))).contact.lastContactAt

test('a note that mentions a contact is saved, listed and dates the contact', async ({
  request,
  cleanup,
}) => {
  const contact = await newContact(request, cleanup)
  const tag = unique('tag').replaceAll(' ', '-')
  const occurredAt = hoursAgo(2)
  const { entry } = await newEntry(request, cleanup, {
    kind: 'CALL',
    direction: 'OUTBOUND',
    durationMin: 15,
    location: 'Phone',
    occurredAt,
    tags: [tag],
    bodyJson: doc(
      paragraph(text('Called '), mention(contact.id, contact.displayName), text(' about it.')),
    ),
  })
  expect(entry).toMatchObject({ kind: 'CALL', durationMin: 15, occurredAt })
  expect(entry.mentions.map((m) => m.contact.id)).toEqual([contact.id])
  expect(entry.tags.map((t) => t.tag.name)).toEqual([tag])
  expect(entry.bodyText).toContain('about it.')

  // A past entry is contact: the person was last spoken to then.
  expect(await lastContactOf(request, contact.id)).toBe(occurredAt)

  const read = await json<Listed>(await request.get(`/api/entries/${entry.id}`))
  expect(read).toMatchObject({ id: entry.id, followUp: null, followsUp: null })

  const forContact = await json<Listed[]>(await request.get(`/api/entries?contactId=${contact.id}`))
  expect(forContact.map((e) => e.id)).toEqual([entry.id])
  const calls = await json<Listed[]>(
    await request.get(`/api/entries?contactId=${contact.id}&kind=CALL`),
  )
  expect(calls).toHaveLength(1)
  const notes = await json<Listed[]>(
    await request.get(`/api/entries?contactId=${contact.id}&kind=NOTE`),
  )
  expect(notes).toEqual([])
})

test('past and upcoming split the feed at now, and take limits it', async ({
  request,
  cleanup,
}) => {
  const contact = await newContact(request, cleanup)
  const body = doc(paragraph(mention(contact.id, contact.displayName)))
  const { entry: past } = await newEntry(request, cleanup, {
    occurredAt: hoursAgo(5),
    bodyJson: body,
  })
  const { entry: ahead } = await newEntry(request, cleanup, {
    occurredAt: daysAhead(10),
    bodyJson: body,
  })
  const ids = async (query: string) =>
    (await json<Listed[]>(await request.get(`/api/entries?contactId=${contact.id}${query}`))).map(
      (e) => e.id,
    )

  expect(await ids('')).toEqual([ahead.id, past.id])
  expect(await ids('&past=1')).toEqual([past.id])
  expect(await ids('&upcoming=1')).toEqual([ahead.id])
  expect(await ids('&take=1')).toEqual([ahead.id])
  expect(await ids('&take=1&skip=1')).toEqual([past.id])
  // A planned entry is not contact yet.
  expect(await lastContactOf(request, contact.id)).toBe(past.occurredAt)
})

test('PATCH changes only what it is sent', async ({ request, cleanup }) => {
  const { entry } = await newEntry(request, cleanup, { kind: 'MEETING', location: 'Office' })
  const title = unique('Retitled')
  const saved = await json<{ entry: Entry }>(
    await request.patch(`/api/entries/${entry.id}`, { data: { title } }),
  )
  expect(saved.entry).toMatchObject({ title, kind: 'MEETING', occurredAt: entry.occurredAt })
  const read = await json<Entry & { location: string }>(
    await request.get(`/api/entries/${entry.id}`),
  )
  expect(read).toMatchObject({ title, location: 'Office' })
})

test('a follow-up date makes a linked note on that day', async ({ request, cleanup }) => {
  const contact = await newContact(request, cleanup)
  const { entry } = await newEntry(request, cleanup, {
    title: unique('Lunch'),
    occurredAt: hoursAgo(1),
    bodyJson: doc(paragraph(text('Lunch with '), mention(contact.id, contact.displayName))),
  })
  await json(
    await request.patch(`/api/entries/${entry.id}`, { data: { followUpAt: daysAhead(7) } }),
  )
  const read = await json<Listed>(await request.get(`/api/entries/${entry.id}`))
  expect(read.followUp).toMatchObject({ title: `Follow up — ${entry.title}`, written: false })
  cleanup.record('entry', read.followUp!.id)

  // The follow-up carries the same people, so it is planned with them.
  const upcoming = await json<Listed[]>(
    await request.get(`/api/entries?contactId=${contact.id}&upcoming=1`),
  )
  expect(upcoming.map((e) => e.id)).toEqual([read.followUp!.id])
  expect(upcoming[0].followsUp?.id).toBe(entry.id)
})

test('a note creates the contacts, tasks and projects it names inline, as drafts', async ({
  request,
  cleanup,
}) => {
  const person = unique('Inline Person')
  const task = unique('Inline task')
  const project = unique('Inline project')
  const { entry, createdEntities } = await newEntry(request, cleanup, {
    bodyJson: doc(
      paragraph(
        mention('new:person', person),
        text(' will do '),
        reference('task', 'new:task', task),
        text(' for '),
        reference('project', 'new:project', project),
      ),
    ),
    pendingEntities: [
      { tempId: 'new:person', type: 'contact', label: person },
      { tempId: 'new:task', type: 'task', label: task },
      { tempId: 'new:project', type: 'project', label: project },
    ],
  })
  expect(createdEntities.map((e) => e.type).sort()).toEqual(['contact', 'project', 'task'])
  const made = Object.fromEntries(createdEntities.map((e) => [e.type, e.id]))
  expect(entry.mentions.map((m) => m.contact.id)).toEqual([made.contact])

  const drafts = await json<{
    contacts: { id: string; displayName: string }[]
    tasks: { id: string; title: string }[]
    projects: { id: string; name: string }[]
  }>(await request.get('/api/drafts'))
  expect(drafts.contacts).toContainEqual(expect.objectContaining({ id: made.contact }))
  expect(drafts.tasks).toContainEqual(expect.objectContaining({ id: made.task, title: task }))
  expect(drafts.projects).toContainEqual(
    expect.objectContaining({ id: made.project, name: project }),
  )
})

test('a deleted note leaves the feed and gives back the contact date', async ({
  request,
  cleanup,
}) => {
  const contact = await newContact(request, cleanup)
  const { entry } = await newEntry(request, cleanup, {
    occurredAt: hoursAgo(3),
    bodyJson: doc(paragraph(mention(contact.id, contact.displayName))),
  })
  expect(await lastContactOf(request, contact.id)).toBe(entry.occurredAt)

  await json(await request.delete(`/api/entries/${entry.id}`))
  expect(await json(await request.get(`/api/entries/${entry.id}`))).toBeNull()
  expect(await json(await request.get(`/api/entries?contactId=${contact.id}`))).toEqual([])
  expect(await lastContactOf(request, contact.id)).toBeNull()
})

test.describe('refusals', () => {
  test('unknown kinds, null dates and out-of-range numbers are refused', async ({ request }) => {
    const post = (data: Record<string, unknown>) => request.post('/api/entries', { data })
    await invalid(await post({ kind: 'MEMO' }), 'kind')
    await invalid(await post({ occurredAt: null }), 'occurredAt')
    await invalid(await post({ occurredAt: 'not a date' }), 'occurredAt')
    await invalid(await post({ durationMin: 24 * 60 + 1 }), 'durationMin')
    await invalid(await post({ direction: 'SIDEWAYS' }), 'direction')
    await invalid(await post({ tags: [''] }), 'tags.0')
    await invalid(
      await post({ pendingEntities: [{ tempId: 'tmp:1', type: 'contact', label: 'X' }] }),
      'pendingEntities.0.tempId',
    )
  })

  test('the list refuses bad filters', async ({ request }) => {
    await invalid(await request.get('/api/entries?take=0'), 'take')
    await invalid(await request.get('/api/entries?take=500'), 'take')
    await invalid(await request.get('/api/entries?take=many'), 'take')
    await invalid(await request.get('/api/entries?skip=-1'), 'skip')
    await invalid(await request.get('/api/entries?kind=MEMO'), 'kind')
    await invalid(await request.get('/api/entries?past=yes'), 'past')
  })

  test('PATCH refuses a null date', async ({ request, cleanup }) => {
    const { entry } = await newEntry(request, cleanup)
    await invalid(
      await request.patch(`/api/entries/${entry.id}`, { data: { occurredAt: null } }),
      'occurredAt',
    )
  })

  test('an unknown note is not found', async ({ request }) => {
    await refused(
      await request.patch(`/api/entries/${UNKNOWN}`, { data: { title: 'x' } }),
      404,
      'Not found',
    )
    await refused(await request.delete(`/api/entries/${UNKNOWN}`), 404, 'Not found')
  })

  // ⚠️ Not a 404: reading an unknown note answers null, which its page shows as not found
  // (master.md, open question 13).
  test('reading an unknown note answers null', async ({ request }) => {
    expect(await json(await request.get(`/api/entries/${UNKNOWN}`))).toBeNull()
  })
})
