/**
 * The README's screenshots, of the demo seed only: no real person's data is ever in the
 * stack that takes them (scripts/screenshots.sh). Each waits for its page's own heading and
 * for the network to settle, so nothing is caught half loaded.
 */
import { expect, test, type Page } from '@playwright/test'
import { SEEDED, seededIds, type SeededIds } from '../support/stack'

const OUT = 'docs/screenshots'

interface Shot {
  name: string
  path: (ids: SeededIds) => string
  heading: string | RegExp
}

const GREETING = /^(Hello|Good (morning|afternoon|evening)), You\.$/

const DESKTOP: Shot[] = [
  { name: 'today', path: () => '/', heading: GREETING },
  { name: 'contact', path: (ids) => `/contacts/${ids.contact}`, heading: SEEDED.contact },
  { name: 'notes', path: () => '/notes', heading: 'Notes & communications' },
  { name: 'board', path: () => '/board', heading: 'Board' },
]

const PHONE: Shot[] = [
  { name: 'phone-today', path: () => '/m', heading: GREETING },
  { name: 'phone-contact', path: (ids) => `/m/contacts/${ids.contact}`, heading: SEEDED.contact },
]

async function take(page: Page, shot: Shot, ids: SeededIds) {
  const response = await page.goto(shot.path(ids))
  expect(response?.status()).toBe(200)
  await page.waitForLoadState('networkidle')
  // Some headings are for screen readers only, so only their presence is waited for.
  await expect(page.getByRole('heading', { level: 1, name: shot.heading })).toHaveCount(1)
  await page.screenshot({ path: `${OUT}/${shot.name}.png`, animations: 'disabled' })
}

for (const shot of DESKTOP) {
  test(`${shot.name}`, { tag: '@desktop' }, async ({ page, request }) => {
    await take(page, shot, await seededIds(request))
  })
}

for (const shot of PHONE) {
  test(`${shot.name}`, { tag: '@phone' }, async ({ page, request }) => {
    await take(page, shot, await seededIds(request))
  })
}
