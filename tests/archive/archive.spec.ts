import { readFile } from 'node:fs/promises'
import { test, expect } from '../support/fixtures'
import { json, newContact } from '../support/api'
import { conforms } from '../support/contract'

interface Archive {
  format: string
  version: number
  counts: Record<string, number>
  data: Record<string, unknown[]>
}

test('download and restore an archive without changing its records', async ({
  page,
  request,
  cleanup,
}) => {
  await newContact(request, cleanup)
  await page.goto('/settings')
  await page.waitForLoadState('networkidle')
  const before = await json<Archive>(await request.get('/api/export'))
  const downloading = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download archive', exact: true }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^kinship-archive-.*\.json$/)
  const path = await download.path()
  expect(path).not.toBeNull()
  const bytes = await readFile(path!)
  const archive = JSON.parse(bytes.toString()) as Archive
  expect(archive.format).toBe('kb-archive')
  expect(archive.counts).toEqual(before.counts)
  expect(archive.data).toEqual(before.data)
  await page.locator('input[type=file]').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: bytes,
  })
  await expect(page.getByRole('button', { name: 'Replace everything', exact: true })).toBeDisabled()
  await page.getByPlaceholder('replace', { exact: true }).fill('replace')
  const reloaded = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame === page.mainFrame(),
  })
  const importing = page.waitForResponse((r) => r.url().includes('/api/import?confirm=replace'))
  await page.getByRole('button', { name: 'Replace everything', exact: true }).click()
  const imported = await importing
  expect(imported.status()).toBe(200)
  // The one success tests/integration/openapi.spec.ts cannot check: it replaces everything.
  await conforms(imported, 'post', '/api/import')
  const after = await json<Archive>(await request.get('/api/export'))
  expect(after.counts).toEqual(before.counts)
  // Settings is recreated with a new internal id on import; nothing references that id.
  const records = (archive: Archive) => ({
    ...archive.data,
    Settings: archive.data.Settings.map((row) => {
      const settings = { ...(row as Record<string, unknown>) }
      delete settings.id
      return settings
    }),
  })
  expect(records(after)).toEqual(records(before))
  for (let n = 0; n < 2; n++) {
    const repeated = await request.post('/api/import?confirm=replace', { data: archive })
    expect(repeated.status()).toBe(200)
    const repeatedExport = await json<Archive>(await request.get('/api/export'))
    expect(records(repeatedExport)).toEqual(records(after))
  }
  await expect(page.getByText(/Restored \d+ rows/)).toBeVisible()
  await reloaded
  await page.waitForLoadState('networkidle')
})

test('the legacy kb-archive v1 seed imports through settings with an explicit schema override', async ({
  page,
  request,
  refusals,
}) => {
  const path = 'tests/fixtures/archive-v1.json'
  const fixture = JSON.parse(await readFile(path, 'utf8')) as Archive
  expect(fixture.format).toBe('kb-archive')
  expect(fixture.version).toBe(1)
  expect(fixture.counts.Contact).toBe(3)
  expect(fixture.counts.Task).toBe(5)
  await page.goto('/settings')
  await page.waitForLoadState('networkidle')
  const before = await json<Archive>(await request.get('/api/export'))
  refusals.push({ status: 400, method: 'POST', path: '/api/import?confirm=replace' })
  await page.locator('input[type=file]').setInputFiles(path)
  await page.getByPlaceholder('replace', { exact: true }).fill('replace')
  const importing = page.waitForResponse((r) => r.url().includes('/api/import?confirm=replace'))
  await page.getByRole('button', { name: 'Replace everything', exact: true }).click()
  const answer = await importing
  expect(answer.status()).toBe(400)
  await expect(
    page.getByText(/Applied here but not in the archive: 20261010150000_rebuild_contact_recency/),
  ).toBeVisible()
  const rejected = await json<Archive>(await request.get('/api/export'))
  expect(rejected.counts).toEqual(before.counts)
  expect(rejected.data).toEqual(before.data)
  await expect(page.getByRole('button', { name: 'Import anyway', exact: true })).toBeVisible()
  const reloaded = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame === page.mainFrame(),
  })
  const forcing = page.waitForResponse((r) =>
    r.url().includes('/api/import?confirm=replace&force=1'),
  )
  await page.getByRole('button', { name: 'Import anyway', exact: true }).click()
  expect((await forcing).status()).toBe(200)
  const after = await json<Archive>(await request.get('/api/export'))
  expect(after.counts).toEqual(fixture.counts)
  // The fixture predates the removal of photos: its contacts carry an avatarUrl
  // column, and it an uploads list, that this version drops on import.
  expect(after.data).toEqual({
    ...fixture.data,
    Contact: fixture.data.Contact.map((row) => {
      const contact = { ...(row as Record<string, unknown>) }
      delete contact.avatarUrl
      return contact
    }),
  })
  expect(after).not.toHaveProperty('uploads')
  await expect(page.getByText(/Restored 58 rows/)).toBeVisible()
  await reloaded
  await page.waitForLoadState('networkidle')
})
