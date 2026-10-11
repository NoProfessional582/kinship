/**
 * The 3D map page (/map): it draws the seeded records, picks a record under the pointer,
 * and shows its other states: no records, a failed request (and its retry), and a browser
 * without WebGL, which lists the records instead. Leaving the page frees the canvas.
 *
 * Headless Chromium draws WebGL in software, so these check that something was drawn and
 * what it looks like broadly (coloured orbs on a dark sky), not exact pixels.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../support/fixtures'
import { SEEDED } from '../support/stack'

const canvasOf = (page: Page) => page.getByTestId('graph-canvas').locator('canvas')

/** Waits until the scene has drawn its first frame (the page's performance entry). */
async function drawn(page: Page) {
  await expect(canvasOf(page)).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => performance.getEntriesByName('graph:first-draw').length))
    .toBeGreaterThan(0)
}

/**
 * The share of the element's pixels in a strong colour, as the orbs and their auras are;
 * the sky is near black and the stars white, so neither counts.
 */
async function colouredShare(page: Page, target: Locator): Promise<number> {
  const png = await target.screenshot()
  return page.evaluate(async (base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let coloured = 0
    for (let i = 0; i < data.length; i += 4) {
      const max = Math.max(data[i], data[i + 1], data[i + 2])
      const min = Math.min(data[i], data[i + 1], data[i + 2])
      if (max > 90 && max - min > 60) coloured++
    }
    return coloured / (canvas.width * canvas.height)
  }, png.toString('base64'))
}

/** The page as a browser without WebGL sees it: no WebGL context can be made. */
async function withoutWebgl(page: Page) {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...rest: unknown[]
    ) {
      if (/webgl/.test(kind)) return null
      return (getContext as (...args: unknown[]) => unknown).call(this, kind, ...rest)
    } as typeof getContext
  })
}

test('the map draws the seeded records', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/map')
  await expect(page.getByRole('heading', { level: 1, name: 'Map' })).toHaveCount(1)
  await drawn(page)
  const share = await colouredShare(page, canvasOf(page))
  expect(share, 'coloured orbs and auras on the dark sky').toBeGreaterThan(0.001)
})

test('a record under the pointer is picked', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/map')
  await drawn(page)
  const canvas = canvasOf(page)
  const box = (await canvas.boundingBox())!
  // Sweep the middle of the view until the pointer is over a record's hit proxy.
  let found = false
  for (let row = 1; row < 16 && !found; row++) {
    for (let col = 1; col < 24 && !found; col++) {
      await page.mouse.move(box.x + (box.width * col) / 24, box.y + (box.height * row) / 16)
      found = (await canvas.evaluate((el) => el.style.cursor)) === 'pointer'
    }
  }
  expect(found, 'some point over a record shows the pointer cursor').toBe(true)
  // Off every record, the cursor goes back.
  await page.mouse.move(box.x + 2, box.y + 2)
  await expect.poll(() => canvas.evaluate((el) => el.style.cursor)).toBe('')
})

test('with no records the map says so', { tag: '@desktop' }, async ({ page }) => {
  await page.route('**/api/graph', (route) => route.fulfill({ json: { nodes: [], links: [] } }))
  await page.goto('/map')
  await expect(page.getByText('No records yet', { exact: true })).toBeVisible()
  await expect(canvasOf(page)).toHaveCount(0)
})

test(
  'a failed request shows an error, and trying again draws the map',
  {
    tag: '@desktop',
  },
  async ({ page, refusals }) => {
    // A 4xx, which the app does not retry by itself, so the refusal happens exactly once.
    refusals.push({ status: 400, method: 'GET', path: '/api/graph' })
    let fail = true
    await page.route('**/api/graph', (route) =>
      fail
        ? route.fulfill({ status: 400, json: { error: 'Refused for the test' } })
        : route.continue(),
    )
    await page.goto('/map')
    // Next's route announcer is an alert too, so look for this one by its words.
    await expect(
      page.getByRole('alert').filter({ hasText: 'The map could not load your records.' }),
    ).toBeVisible()
    fail = false
    await page.getByRole('button', { name: 'Try again' }).click()
    await drawn(page)
  },
)

test(
  'without WebGL the records are listed, with working links',
  {
    tag: '@desktop',
  },
  async ({ page }) => {
    await withoutWebgl(page)
    await page.goto('/map')
    await expect(page.getByRole('note')).toContainText('The 3D map needs WebGL')
    await expect(canvasOf(page)).toHaveCount(0)
    const people = page.getByRole('region', { name: /^People/ })
    await expect(people.getByRole('link', { name: SEEDED.contact, exact: true })).toBeVisible()
    await expect(
      page.getByRole('region', { name: /^Projects/ }).getByRole('link', { name: SEEDED.project }),
    ).toBeVisible()
    // Tags have no page of their own, so they are listed without a link.
    const tags = page.getByRole('region', { name: /^Tags/ })
    if ((await tags.count()) > 0) await expect(tags.getByRole('link')).toHaveCount(0)

    await people.getByRole('link', { name: SEEDED.contact, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: SEEDED.contact })).toBeVisible()
  },
)

test('leaving the map frees the canvas', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/map')
  await drawn(page)
  // In-app navigation, so the page unmounts rather than unloads.
  await page.getByRole('link', { name: 'Contacts' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Contacts' })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  await page.goBack()
  await drawn(page)
})

test('the map fits a phone and turns with a finger', { tag: '@phone' }, async ({ page }) => {
  await page.goto('/map')
  await drawn(page)
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  expect(fits, 'no sideways scroll').toBe(true)

  const canvas = canvasOf(page)
  const before = await canvas.screenshot()
  const box = (await canvas.boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  const at = (x: number) => [{ x: box.x + x, y: box.y + box.height / 2 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(60) })
  for (let x = 70; x <= 260; x += 10) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(x) })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false)
})
