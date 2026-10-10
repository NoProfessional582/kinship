import { readFile } from 'node:fs/promises'
import { test, expect } from '../support/fixtures'
import { json } from '../support/api'

interface Archive {
  format: string
  version: number
  counts: Record<string, number>
  data: Record<string, unknown[]>
  uploads: { name: string; data: string }[]
}

test('download and restore an archive without changing its records', async ({ page, request }) => {
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
  const importing = page.waitForResponse((r) => r.url().includes('/api/import?confirm=replace'))
  await page.getByRole('button', { name: 'Replace everything', exact: true }).click()
  expect((await importing).status()).toBe(200)
  const after = await json<Archive>(await request.get('/api/export'))
  expect(after.counts).toEqual(before.counts)
  // Settings is recreated with a new internal id on import; nothing references that id.
  const records = (data: Record<string, unknown[]>) => ({
    ...data,
    Settings: data.Settings.map((row) => {
      const settings = { ...(row as Record<string, unknown>) }
      delete settings.id
      return settings
    }),
  })
  expect(records(after.data)).toEqual(records(before.data))
  // Restoring stages fresh filenames so a failed transaction cannot overwrite originals.
  expect(after.uploads).toEqual(expect.arrayContaining(before.uploads))
  expect(after.uploads).toHaveLength(before.uploads.length * 2)
  expect(after.uploads.map((u) => u.data).sort()).toEqual(
    [...before.uploads, ...before.uploads].map((u) => u.data).sort(),
  )
  expect(new Set(after.uploads.map((u) => u.name)).size).toBe(after.uploads.length)
  await expect(page.getByText(/Restored \d+ rows/)).toBeVisible()
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
  expect(rejected.uploads).toEqual(before.uploads)
  await expect(page.getByRole('button', { name: 'Import anyway', exact: true })).toBeVisible()
  const forcing = page.waitForResponse((r) =>
    r.url().includes('/api/import?confirm=replace&force=1'),
  )
  await page.getByRole('button', { name: 'Import anyway', exact: true }).click()
  expect((await forcing).status()).toBe(200)
  const after = await json<Archive>(await request.get('/api/export'))
  expect(after.counts).toEqual(fixture.counts)
  expect(after.data).toEqual(fixture.data)
  // Import stages archive assets; it preserves unrelated existing files.
  expect(after.uploads).toEqual(before.uploads)
  await expect(page.getByText(/Restored 58 rows/)).toBeVisible()
})
