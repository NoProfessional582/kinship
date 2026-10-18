/**
 * Kinship has no sign-in: everything acts as the one owner the server is configured with
 * (KINSHIP_OWNER), and no request header can change that (lib/identity.ts). These are the
 * headers sign-in proxies use to name a user; sending them changes nothing.
 */
import { test, expect, json, newContact, newEntry, type Contact } from '../support/api'
import { SEEDED, seededIds } from '../support/stack'
import type { APIRequestContext } from '@playwright/test'

const IDENTITY_HEADERS = {
  'X-Estate-User': 'intruder',
  'Remote-User': 'intruder',
  'X-Forwarded-User': 'intruder',
  'X-Remote-User': 'intruder',
}

/** The owner every record belongs to: the seeded contact's. */
const ownerOf = async (request: APIRequestContext, contactId: string) =>
  (await json<{ contact: Contact }>(await request.get(`/api/contacts/${contactId}`))).contact.owner

test('every GET answers the same with or without identity headers', async ({ request }) => {
  const ids = await seededIds(request)
  const board = await json<{ tasks: { id: string }[] }>(await request.get('/api/tasks'))
  const now = Date.now()
  const window = `start=${new Date(now - 30 * 86_400_000).toISOString()}&end=${new Date(now + 30 * 86_400_000).toISOString()}`

  const paths = [
    '/api/health',
    '/api/weather',
    '/api/settings',
    '/api/cadence',
    '/api/drafts',
    '/api/contacts',
    `/api/contacts/${ids.contact}`,
    `/api/contacts/${ids.contact}/attributes`,
    '/api/entries',
    `/api/entries/${ids.note}`,
    '/api/projects',
    `/api/projects/${ids.project}`,
    '/api/tasks',
    `/api/tasks/${board.tasks[0].id}`,
    '/api/columns',
    `/api/edges?type=contact&id=${ids.contact}`,
    `/api/calendar?${window}`,
    `/api/search?q=${encodeURIComponent(SEEDED.contact)}`,
    '/api/search/mentions?type=contact&q=Ma',
    '/api/search/mentions?type=entity&q=site',
    '/api/trash',
    '/api/export',
    '/icons/192',
  ]
  for (const path of paths) {
    const plain = await request.get(path)
    const claimed = await request.get(path, { headers: IDENTITY_HEADERS })
    expect(claimed.status(), path).toBe(plain.status())
    expect(plain.status(), path).toBe(200)
    if (plain.headers()['content-type']?.includes('application/json')) {
      // An export is stamped with the time it was made; everything else must match.
      const body = async (r: typeof plain) => ({ ...(await r.json()), exportedAt: undefined })
      expect(await body(claimed), path).toEqual(await body(plain))
    } else {
      expect(Buffer.compare(await claimed.body(), await plain.body()), path).toBe(0)
    }
  }
})

test('what a request with identity headers saves belongs to the owner', async ({
  request,
  cleanup,
}) => {
  const owner = await ownerOf(request, (await seededIds(request)).contact)
  expect(owner).not.toBe('intruder')

  const contact = await newContact(request, cleanup, {})
  const claimed = await json<Contact>(
    await request.post('/api/contacts', {
      headers: IDENTITY_HEADERS,
      data: { displayName: `${contact.displayName} (claimed)` },
    }),
  )
  cleanup.record('contact', claimed.id)
  expect(claimed.owner).toBe(owner)
  expect(await ownerOf(request, claimed.id)).toBe(owner)

  const { entry } = await newEntry(request, cleanup)
  const edited = await json<{ entry: { owner: string } }>(
    await request.patch(`/api/entries/${entry.id}`, {
      headers: IDENTITY_HEADERS,
      data: { title: 'Edited with identity headers' },
    }),
  )
  expect(edited.entry.owner).toBe(owner)
})
