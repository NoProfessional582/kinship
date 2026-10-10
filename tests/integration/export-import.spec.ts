/**
 * GET /api/export (the archive download) and POST /api/import's refusals. Every import here
 * is refused, so nothing is replaced; the imports that do replace the owner's data run last,
 * in the `archive` project (tests/archive).
 */
import { test, expect, json, refused, newContact } from '../support/api'
import type { APIRequestContext } from '@playwright/test'

interface Archive {
  format: string
  version: number
  exportedAt: string
  migrations: string[]
  counts: Record<string, number>
  data: Record<string, { id?: string }[]>
  uploads: { name: string; data: string }[]
}

// Every table, in the order an import writes them (lib/archive-rows.ts, MODEL_ORDER).
const TABLES = [
  'Tag',
  'Contact',
  'ContactAttribute',
  'ContactChannel',
  'ContactPosition',
  'ContactMilestone',
  'ContactLink',
  'Project',
  'BoardColumn',
  'Task',
  'TaskAssignee',
  'Entry',
  'Mention',
  'EntityRef',
  'ContactTag',
  'EntryTag',
  'TaskTag',
  'EntityEdge',
  'Settings',
]

const exported = async (request: APIRequestContext) =>
  json<Archive>(await request.get('/api/export'))

/** What an archive holds, apart from when it was made. */
const contents = (archive: Archive) => ({ ...archive, exportedAt: undefined })

/** POSTs a file to import, as the settings page does: the file's bytes, as they are. */
const importing = (request: APIRequestContext, body: unknown, query = '?confirm=replace') =>
  request.post(`/api/import${query}`, {
    headers: { 'content-type': 'application/json' },
    // Bytes, because Playwright would encode a string that is not valid JSON.
    data: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
  })

const archive = (fields: Record<string, unknown>) => ({
  format: 'kb-archive',
  version: 1,
  data: {},
  ...fields,
})

test('the export is a kinship-archive file holding every table', async ({ request, cleanup }) => {
  const contact = await newContact(request, cleanup)
  const response = await request.get('/api/export')
  expect(response.status()).toBe(200)
  const headers = response.headers()
  expect(headers['content-type']).toBe('application/json; charset=utf-8')
  expect(headers['cache-control']).toBe('no-store')
  expect(headers['content-disposition']).toMatch(
    /^attachment; filename="kinship-archive-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json"$/,
  )
  const body = await response.body()
  expect(Number(headers['content-length'])).toBe(body.byteLength)

  const file = JSON.parse(body.toString('utf8')) as Archive
  // The marker from before the app was Kinship, so archives move both ways.
  expect(file).toMatchObject({ format: 'kb-archive', version: 1 })
  expect(new Date(file.exportedAt).getTime()).not.toBeNaN()
  expect(file.migrations[0]).toBe('20260821012400_init')
  expect(file.migrations).toEqual([...file.migrations].sort())
  expect(Object.keys(file.data)).toEqual(TABLES)
  expect(Object.keys(file.counts)).toEqual(TABLES)
  for (const table of TABLES) expect(file.counts[table], table).toBe(file.data[table].length)
  expect(file.data.Contact.map((c) => c.id)).toContain(contact.id)
})

test.describe('refusals, which change nothing', () => {
  let before: ReturnType<typeof contents>

  test.beforeEach(async ({ request }) => {
    before = contents(await exported(request))
  })

  test.afterEach(async ({ request }) => {
    expect(contents(await exported(request))).toEqual(before)
  })

  test('an import must say it replaces everything', async ({ request }) => {
    const message =
      'Importing replaces every row in this database. Re-send with ?confirm=replace to proceed.'
    await refused(await importing(request, archive({}), ''), 400, message)
    await refused(await importing(request, archive({}), '?confirm=yes'), 400, message)
  })

  test('the file must be JSON, and an archive', async ({ request }) => {
    await refused(await importing(request, 'not json {'), 400, 'That file is not JSON.')
    await refused(
      await importing(request, {}),
      400,
      'That file is not a valid archive: Not a Kinship archive (missing the "kb-archive" marker)',
    )
    await refused(
      await importing(request, archive({ format: 'something-else' })),
      400,
      'That file is not a valid archive: Not a Kinship archive (missing the "kb-archive" marker)',
    )
  })

  test('an archive from a newer app or schema is refused', async ({ request }) => {
    await refused(
      await importing(request, archive({ version: 2 })),
      400,
      'Archive format v2 was written by a newer version of this app (this one reads up to v1). ' +
        'Update before importing.',
    )
    await refused(
      await importing(request, archive({ data: { Bogus: [] } })),
      400,
      'Archive holds tables this app does not know: Bogus. It was written by a newer schema.',
    )
    await refused(
      await importing(request, archive({ migrations: ['20990101000000_future'] })),
      400,
      /^This database is on a different schema than the archive\. Not applied here: 20990101000000_future\. Applied here but not in the archive: 20260821012400_init, .*\. Bring both sides to the same migrations, or override this check to import anyway\.$/,
    )
  })

  test('rows must be well formed and link only to rows the archive carries', async ({
    request,
  }) => {
    await refused(
      await importing(
        request,
        archive({
          data: { Contact: [{ id: 'c1', slug: 'x', displayName: 'X', createdAt: 'May' }] },
        }),
      ),
      400,
      'Contact.createdAt is not a date: "May"',
    )
    await refused(
      await importing(
        request,
        archive({ data: { Mention: [{ entryId: 'e1', contactId: 'c1' }] } }),
      ),
      400,
      'Mention.entryId refers to "e1", which this archive does not contain. ' +
        'An import may only link rows it carries itself. Nothing was changed.',
    )
  })

  test('uploads must be bare names holding images', async ({ request }) => {
    await refused(
      await importing(request, archive({ uploads: [{ name: '../evil.png', data: 'AAAA' }] })),
      400,
      'That file is not a valid archive: Upload names must be bare filenames',
    )
    await refused(
      await importing(request, archive({ uploads: [{ name: 'x.png', data: 'not base64!' }] })),
      400,
      'That file is not a valid archive: Upload data must be base64',
    )
    await refused(
      await importing(
        request,
        archive({
          uploads: [{ name: 'page.png', data: Buffer.from('<html></html>').toString('base64') }],
        }),
      ),
      400,
      'Archive upload "page.png" is not an image this app accepts. Uploads must be one of: ' +
        'image/png, image/jpeg, image/gif, image/webp. Nothing was written.',
    )
  })

  test('a body over 9 MB is too large', async ({ request }) => {
    const padding = 'x'.repeat(9.5 * 1024 * 1024)
    await refused(
      await importing(request, archive({ exportedAt: padding })),
      413,
      'Request body too large. The maximum is 9 MB.',
    )
  })
})
