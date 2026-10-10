/**
 * /api/contacts, /api/contacts/[id], /api/contacts/[id]/attributes, and /api/cadence (the
 * people overdue for a check-in).
 */
import {
  test,
  expect,
  json,
  refused,
  invalid,
  unique,
  newContact,
  type Contact,
  type TrashList,
} from '../support/api'

interface Dossier {
  contact: Contact & {
    tags: { tag: { name: string } }[]
    channels: { type: string; value: string; isPreferred: boolean }[]
    links: { label: string; url: string }[]
  }
  entries: unknown[]
  tasks: unknown[]
  projects: unknown[]
  upcoming: unknown[]
}

type Listed = Pick<Contact, 'id' | 'slug' | 'displayName' | 'isDraft'>

const UNKNOWN = 'no-such-contact'

test('a contact is created with its channels, links, tags and details', async ({
  request,
  cleanup,
}) => {
  const tag = unique('tag').replaceAll(' ', '-')
  const contact = await newContact(request, cleanup, {
    displayName: unique('Ada Contact'),
    headline: 'Writes the release notes',
    tags: [tag],
    channels: [
      { type: 'EMAIL', value: 'ada@example.com', isPreferred: false },
      { type: 'PHONE', value: '+1 555 0100', isPreferred: true },
    ],
    // A bare host is stored as https.
    links: [{ label: 'Site', url: 'ada.example.org' }],
    attributes: [{ category: 'Work', key: 'Desk', value: '3F' }],
  })
  expect(contact.slug).toMatch(/^ada-contact-/)
  expect(contact.isDraft).toBe(false)

  const dossier = await json<Dossier>(await request.get(`/api/contacts/${contact.id}`))
  expect(dossier.contact.displayName).toBe(contact.displayName)
  expect(dossier.contact.headline).toBe('Writes the release notes')
  expect(dossier.contact.tags.map((t) => t.tag.name)).toEqual([tag])
  // The preferred channel comes first.
  expect(dossier.contact.channels.map((c) => [c.value, c.isPreferred])).toEqual([
    ['+1 555 0100', true],
    ['ada@example.com', false],
  ])
  expect(dossier.contact.links).toEqual([
    expect.objectContaining({ label: 'Site', url: 'https://ada.example.org' }),
  ])
  expect(dossier.contact.attributes).toEqual([
    expect.objectContaining({ category: 'Work', key: 'Desk', value: '3F' }),
  ])
  expect(dossier).toMatchObject({ entries: [], tasks: [], projects: [], upcoming: [] })

  // The slug finds the same contact.
  const bySlug = await json<Dossier>(await request.get(`/api/contacts/${contact.slug}`))
  expect(bySlug.contact.id).toBe(contact.id)
})

test('the list finds contacts by name, by tag, and drafts only', async ({ request, cleanup }) => {
  const tag = unique('tag').replaceAll(' ', '-')
  const contact = await newContact(request, cleanup, { tags: [tag] })
  const draft = await newContact(request, cleanup, { isDraft: true })

  const byName = await json<Listed[]>(
    await request.get(`/api/contacts?q=${encodeURIComponent(contact.displayName)}`),
  )
  expect(byName.map((c) => c.id)).toEqual([contact.id])

  const byTag = await json<Listed[]>(await request.get(`/api/contacts?tag=${tag}`))
  expect(byTag.map((c) => c.id)).toEqual([contact.id])

  const drafts = await json<Listed[]>(await request.get('/api/contacts?drafts=1'))
  expect(drafts.map((c) => c.id)).toContain(draft.id)
  expect(drafts.map((c) => c.id)).not.toContain(contact.id)
  expect(drafts.every((c) => c.isDraft)).toBe(true)

  const all = await json<Listed[]>(await request.get('/api/contacts'))
  expect(all.map((c) => c.id)).toEqual(expect.arrayContaining([contact.id, draft.id]))
})

test('PATCH saves the whole dossier the form sends', async ({ request, cleanup }) => {
  const contact = await newContact(request, cleanup, { headline: 'Before' })
  const renamed = unique('Renamed Contact')
  const saved = await json<Contact>(
    await request.patch(`/api/contacts/${contact.id}`, {
      data: { displayName: renamed, headline: 'After', location: 'Lisbon', cadence: 'MONTHLY' },
    }),
  )
  expect(saved).toMatchObject({ id: contact.id, displayName: renamed, headline: 'After' })

  const dossier = await json<Dossier>(await request.get(`/api/contacts/${contact.id}`))
  expect(dossier.contact).toMatchObject({ displayName: renamed, cadence: 'MONTHLY' })
})

test('the attributes route replaces the whole set', async ({ request, cleanup }) => {
  const contact = await newContact(request, cleanup, {
    attributes: [{ category: 'Work', key: 'Desk', value: '3F' }],
  })
  const path = `/api/contacts/${contact.id}/attributes`
  expect(await json<unknown[]>(await request.get(path))).toHaveLength(1)

  const saved = await json<NonNullable<Contact['attributes']>>(
    await request.put(path, {
      data: {
        attributes: [
          // A blank category becomes "Details".
          { category: '  ', key: 'Shoe size', value: '44' },
          { category: 'Food', key: 'Coffee', value: 'Black' },
        ],
      },
    }),
  )
  expect(saved.map((a) => [a.category, a.key, a.value])).toEqual([
    ['Details', 'Shoe size', '44'],
    ['Food', 'Coffee', 'Black'],
  ])
  expect(await json(await request.get(path))).toEqual(saved)

  await json(await request.put(path, { data: { attributes: [] } }))
  expect(await json(await request.get(path))).toEqual([])
})

test('a deleted contact goes to the trash and out of the lists', async ({ request, cleanup }) => {
  const contact = await newContact(request, cleanup)
  const deleted = await json<{ deletedAt: string | null }>(
    await request.delete(`/api/contacts/${contact.id}`),
  )
  expect(deleted.deletedAt).not.toBeNull()

  await refused(await request.get(`/api/contacts/${contact.id}`), 404, 'Not found')
  const listed = await json<Listed[]>(
    await request.get(`/api/contacts?q=${encodeURIComponent(contact.displayName)}`),
  )
  expect(listed).toEqual([])
  const trash = await json<TrashList>(await request.get('/api/trash'))
  expect(trash.contacts.map((c) => c.id)).toContain(contact.id)
})

test('GET /api/cadence: a contact with a cadence and no contact yet is due', async ({
  request,
  cleanup,
}) => {
  const contact = await newContact(request, cleanup, { cadence: 'WEEKLY' })
  const due = await json<{ id: string; health: { state: string } }[]>(
    await request.get('/api/cadence'),
  )
  expect(due.find((c) => c.id === contact.id)?.health.state).toBe('never')

  const quiet = await newContact(request, cleanup, { cadence: 'NONE' })
  const again = await json<{ id: string }[]>(await request.get('/api/cadence'))
  expect(again.map((c) => c.id)).not.toContain(quiet.id)
})

test.describe('refusals', () => {
  test('a contact needs a name', async ({ request }) => {
    await invalid(
      await request.post('/api/contacts', { data: { displayName: '   ' } }),
      'displayName',
      'A name is required',
    )
    await invalid(await request.post('/api/contacts', { data: {} }), 'displayName')
  })

  test('a link must be http(s) or mailto', async ({ request }) => {
    await invalid(
      await request.post('/api/contacts', {
        data: {
          displayName: unique('Linked'),
          links: [{ label: 'x', url: 'javascript:alert(1)' }],
        },
      }),
      'links.0.url',
      'Links must be http(s) or mailto',
    )
  })

  test('unknown tiers, cadences and channel types are refused', async ({ request }) => {
    const displayName = unique('Refused')
    await invalid(await request.post('/api/contacts', { data: { displayName, tier: 'X' } }), 'tier')
    await invalid(
      await request.post('/api/contacts', { data: { displayName, cadence: 'HOURLY' } }),
      'cadence',
    )
    await invalid(
      await request.post('/api/contacts', {
        data: { displayName, channels: [{ type: 'FAX', value: '1' }] },
      }),
      'channels.0.type',
    )
  })

  test('an attribute needs a label', async ({ request, cleanup }) => {
    const contact = await newContact(request, cleanup)
    await invalid(
      await request.put(`/api/contacts/${contact.id}/attributes`, {
        data: { attributes: [{ category: 'Work', key: '', value: 'x' }] },
      }),
      'attributes.0.key',
    )
  })

  test('an unknown contact is not found', async ({ request }) => {
    const data = { displayName: unique('Nobody') }
    await refused(await request.patch(`/api/contacts/${UNKNOWN}`, { data }), 404, 'Not found')
    await refused(await request.delete(`/api/contacts/${UNKNOWN}`), 404, 'Not found')
    await refused(await request.get(`/api/contacts/${UNKNOWN}`), 404, 'Not found')
    await refused(await request.get(`/api/contacts/${UNKNOWN}/attributes`), 404, 'Not found')
    await refused(
      await request.put(`/api/contacts/${UNKNOWN}/attributes`, { data: { attributes: [] } }),
      404,
      'Not found',
    )
  })
})
