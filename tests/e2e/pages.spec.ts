/**
 * Every page loads clean on its own project: the twelve desktop pages in Desktop Chrome,
 * and eleven of them under /m on a Pixel 7 (the map has no phone page yet). Each has
 * exactly one main heading and shows what makes it that page (its heading, and its own
 * content where the heading is read only by screen readers), and nothing on it errs
 * (support/fixtures.ts).
 *
 * Nothing picks a GUI by device (app/layout.tsx): /m is where the installed phone app
 * starts (app/manifest.ts), and a phone that opens / stays there, on the desktop page in
 * its narrow layout. That is tested too.
 */
import type { Page } from '@playwright/test'
import { test, expect } from '../support/fixtures'
import { BASE_URL, SEEDED, seededIds, type SeededIds } from '../support/stack'

/** What the page must show once it has loaded. */
type Shows = (page: Page) => Promise<void>

/** Its main heading. */
const heading =
  (name: string | RegExp): Shows =>
  async (page) => {
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  }

/** A piece of its own content, for a page whose heading only screen readers read. */
const content =
  (text: string): Shows =>
  async (page) => {
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible()
  }

const both =
  (...checks: Shows[]): Shows =>
  async (page) => {
    for (const check of checks) await check(page)
  }

// The owner's name defaults to "You"; the greeting is "Hello" until the clock is read.
const GREETING = /^(Hello|Good (morning|afternoon|evening)), You\.$/

interface PageCase {
  /** `:contact`, `:project` and `:note` stand for the seeded records' ids. */
  path: string
  shows: Shows
  /** On a phone: the bottom tab marked as the current page, if the page has one. */
  tab?: string
}

const DESKTOP: PageCase[] = [
  { path: '/', shows: heading(GREETING) },
  { path: '/contacts', shows: heading('Contacts') },
  { path: '/contacts/:contact', shows: heading(SEEDED.contact) },
  { path: '/notes', shows: heading('Notes & communications') },
  // A note's heading is for screen readers; on screen the note itself shows its title.
  { path: '/notes/:note', shows: both(heading(SEEDED.note), content(SEEDED.note)) },
  { path: '/projects', shows: heading('Projects') },
  { path: '/projects/:project', shows: heading(SEEDED.project) },
  { path: '/board', shows: heading('Board') },
  // Its heading is the month or week in view.
  { path: '/calendar', shows: heading(/\w/) },
  { path: '/settings', shows: heading('Settings') },
  { path: '/trash', shows: heading('Trash') },
  // The 3D map's heading is for screen readers; its canvas is checked in map.spec.ts.
  { path: '/map', shows: heading('Map') },
]

// Five phone pages have a heading only screen readers read: on screen they go straight to
// their own controls and content, which are checked too.
const PHONE: PageCase[] = [
  { path: '/m', tab: 'Today', shows: heading(GREETING) },
  {
    path: '/m/contacts',
    tab: 'People',
    shows: both(
      heading('People'),
      async (page) => {
        await expect(page.getByPlaceholder('Search people…')).toBeVisible()
      },
      content(SEEDED.contact),
    ),
  },
  { path: '/m/contacts/:contact', tab: 'People', shows: heading(SEEDED.contact) },
  { path: '/m/notes', tab: 'Notes', shows: both(heading('Notes'), content(SEEDED.note)) },
  { path: '/m/notes/:note', tab: 'Notes', shows: heading(SEEDED.note) },
  { path: '/m/projects', shows: both(heading('Projects'), content(SEEDED.project)) },
  { path: '/m/projects/:project', shows: heading(SEEDED.project) },
  {
    path: '/m/board',
    tab: 'Board',
    shows: both(heading('Board'), async (page) => {
      await expect(page.getByLabel('Filter by project')).toBeVisible()
      await expect(page.getByRole('button', { name: /^Backlog/ })).toBeVisible()
    }),
  },
  {
    path: '/m/calendar',
    tab: 'Calendar',
    shows: both(heading('Calendar'), async (page) => {
      await expect(page.getByRole('button', { name: 'Previous week' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'week', pressed: true })).toBeVisible()
    }),
  },
  { path: '/m/settings', shows: heading('Settings') },
  { path: '/m/trash', shows: heading('Trash') },
]

const withIds = (path: string, ids: SeededIds) =>
  path.replace(/:(contact|project|note)\b/, (_, key: keyof SeededIds) => ids[key])

async function open(page: Page, path: string) {
  const response = await page.goto(path)
  expect(response?.status(), `GET ${path}`).toBe(200)
}

/** One main heading, no more: checked once the page has shown its own. */
async function oneMainHeading(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
}

for (const { path, shows } of DESKTOP) {
  test(`${path} loads clean`, { tag: '@desktop' }, async ({ page, request }) => {
    await open(page, path.includes(':') ? withIds(path, await seededIds(request)) : path)
    await shows(page)
    await oneMainHeading(page)
    await page.waitForLoadState('networkidle')
  })
}

for (const { path, shows, tab } of PHONE) {
  test(`${path} loads clean`, { tag: '@phone' }, async ({ page, request }) => {
    await open(page, path.includes(':') ? withIds(path, await seededIds(request)) : path)
    await shows(page)
    await oneMainHeading(page)
    const current = page.getByRole('navigation').locator('a[aria-current="page"]')
    if (tab) await expect(current).toHaveText(tab)
    else await expect(current).toHaveCount(0)
    await page.waitForLoadState('networkidle')
  })
}

test('a phone that opens / stays on the desktop page', { tag: '@phone' }, async ({ page }) => {
  await open(page, '/')
  await heading(GREETING)(page)
  expect(page.url()).toBe(`${BASE_URL}/`)
  await page.waitForLoadState('networkidle')
  expect(page.url()).toBe(`${BASE_URL}/`)
})
