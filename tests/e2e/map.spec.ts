/**
 * The 3D map page (/map): it draws the seeded records, picks a record under the pointer,
 * lights a hovered or selected record's connections and dims the rest, changes live with
 * the overlay's controls (by mouse and by keyboard), and shows its other states: no records, a failed request (and its retry), and a browser
 * without WebGL, which lists the records instead. Leaving the page frees the canvas.
 *
 * Headless Chromium draws WebGL in software, so these check that something was drawn and
 * what it looks like broadly (coloured orbs on a dark sky), not exact pixels.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../support/fixtures'
import { SEEDED } from '../support/stack'

const canvasOf = (page: Page) => page.getByTestId('graph-canvas').locator('canvas')
const mapOf = (page: Page) => page.locator('[data-highlight]')
const statusOf = (page: Page) => page.getByTestId('map-status')

/** How many frames the canvas has drawn so far. */
const framesOf = async (page: Page) =>
  Number((await page.getByTestId('graph-canvas').getAttribute('data-frames')) ?? 0)

/** Whether the canvas draws no frame in the next `ms`: nothing runs in a loop. */
async function still(page: Page, ms = 600) {
  const before = await framesOf(page)
  await page.waitForTimeout(ms)
  return (await framesOf(page)) === before
}

/** Sweeps the middle of the view with the mouse until it is over a record; returns where. */
async function findRecord(page: Page) {
  const canvas = canvasOf(page)
  const box = (await canvas.boundingBox())!
  for (let row = 1; row < 16; row++) {
    for (let col = 1; col < 24; col++) {
      const point = { x: box.x + (box.width * col) / 24, y: box.y + (box.height * row) / 16 }
      await page.mouse.move(point.x, point.y)
      if ((await canvas.evaluate((el) => el.style.cursor)) === 'pointer') return point
    }
  }
  throw new Error('no point over a record shows the pointer cursor')
}

/**
 * A corner of the view, over no record: bottom left, where the status line lets clicks
 * through (the overlay covers the top left).
 */
async function emptySpace(page: Page) {
  const box = (await canvasOf(page).boundingBox())!
  return { x: box.x + 2, y: box.y + box.height - 2 }
}

const overlayOf = (page: Page) => page.getByRole('region', { name: 'Map controls' })

/**
 * A screenshot of the canvas alone: the overlay, legend and status line drawn on top of it
 * are hidden, so a change in them never passes for a change in the map.
 */
const shot = (target: Locator) =>
  target.screenshot({ style: '[data-map-chrome] { visibility: hidden !important; }' })

/** Waits until two screenshots in a row match: the view has settled. */
async function settled(target: Locator) {
  let last = await shot(target)
  await expect
    .poll(async () => {
      const next = await shot(target)
      const same = next.equals(last)
      last = next
      return same
    })
    .toBe(true)
  return last
}

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
  const png = await shot(target)
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
  await findRecord(page)
  // Off every record, the cursor goes back.
  const empty = await emptySpace(page)
  await page.mouse.move(empty.x, empty.y)
  await expect.poll(() => canvas.evaluate((el) => el.style.cursor)).toBe('')
})

test(
  'hovering a record lights its connections and dims the rest',
  { tag: '@desktop' },
  async ({ page }) => {
    await page.goto('/map')
    await drawn(page)
    await expect(statusOf(page)).toHaveText(/^Hover over or select a record/)
    await expect
      .poll(() => still(page), { message: 'nothing draws while the view is still' })
      .toBe(true)
    const resting = await colouredShare(page, canvasOf(page))

    await findRecord(page)
    await expect(mapOf(page)).toHaveAttribute('data-highlight', 'hover')
    await expect(mapOf(page)).not.toHaveAttribute('data-active-id', '')
    await expect(statusOf(page)).toHaveText(/^Hovering: .+ · \d+ direct connections?$/)
    const dimmed = await colouredShare(page, canvasOf(page))
    expect(dimmed, 'the records not connected to it are dimmer').toBeLessThan(resting)
    // A hover draws once; nothing loops after it.
    await expect.poll(() => still(page)).toBe(true)

    const empty = await emptySpace(page)
    await page.mouse.move(empty.x, empty.y)
    await expect(mapOf(page)).toHaveAttribute('data-highlight', 'none')
  },
)

test(
  'clicking selects a record; empty space and Escape clear it',
  { tag: '@desktop' },
  async ({ page }) => {
    await page.goto('/map')
    await drawn(page)
    const point = await findRecord(page)
    const hovered = await mapOf(page).getAttribute('data-active-id')
    await page.mouse.click(point.x, point.y)
    await expect(mapOf(page)).toHaveAttribute('data-highlight', 'selected')
    await expect(mapOf(page)).toHaveAttribute('data-active-id', hovered!)
    await expect(statusOf(page)).toHaveText(/^Selected: .+ · \d+ direct connections?$/)
    // The beacon pulses, so frames keep coming while it is selected.
    expect(await still(page), 'the beacon pulses').toBe(false)

    // Hovering elsewhere does not move the highlight off the selection.
    const empty = await emptySpace(page)
    await page.mouse.move(empty.x, empty.y)
    await expect(mapOf(page)).toHaveAttribute('data-active-id', hovered!)

    await page.mouse.click(empty.x, empty.y)
    await expect(mapOf(page)).toHaveAttribute('data-highlight', 'none')
    await expect.poll(() => still(page)).toBe(true)

    // The selection turned the view to centre on the record, so find one again.
    const again = await findRecord(page)
    await page.mouse.click(again.x, again.y)
    await expect(mapOf(page)).toHaveAttribute('data-highlight', 'selected')
    await page.keyboard.press('Escape')
    // The pointer is still over the record, so the map goes back to previewing it.
    await expect(mapOf(page)).toHaveAttribute('data-highlight', 'hover')
    await expect(statusOf(page)).toHaveText(/^Hovering: /)
    await page.mouse.move(empty.x, empty.y)
    await expect(mapOf(page)).toHaveAttribute('data-highlight', 'none')
    await expect(statusOf(page)).toHaveText(/^Hover over or select a record/)
  },
)

test(
  'with reduced motion the beacon holds still and nothing loops',
  { tag: '@desktop' },
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/map')
    await drawn(page)
    const point = await findRecord(page)
    await page.mouse.click(point.x, point.y)
    await expect(mapOf(page)).toHaveAttribute('data-highlight', 'selected')
    await expect.poll(() => still(page)).toBe(true)
  },
)

test('with no records the map says so', { tag: '@desktop' }, async ({ page }) => {
  await page.route('**/api/graph', (route) => route.fulfill({ json: { nodes: [], links: [] } }))
  await page.goto('/map')
  await expect(page.getByText('No records yet', { exact: true })).toBeVisible()
  await expect(canvasOf(page)).toHaveCount(0)
  await expect(overlayOf(page)).toHaveCount(0)
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
    await expect(overlayOf(page)).toHaveCount(0)
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
  const before = await shot(canvas)
  const box = (await canvas.boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  const at = (x: number) => [{ x: box.x + x, y: box.y + box.height / 2 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(60) })
  for (let x = 70; x <= 260; x += 10) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(x) })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(async () => (await shot(canvas)).equals(before)).toBe(false)
})

test('a tap selects a record on a phone', { tag: '@phone' }, async ({ page }) => {
  await page.goto('/map')
  await drawn(page)
  const point = await findRecord(page)
  await page.touchscreen.tap(point.x, point.y)
  await expect(mapOf(page)).toHaveAttribute('data-highlight', 'selected')
  await expect(statusOf(page)).toBeVisible()
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  expect(fits, 'the status line fits without sideways scroll').toBe(true)
})

test('the overlay changes the map live', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/map')
  await drawn(page)
  const overlay = overlayOf(page)
  const canvas = canvasOf(page)
  await expect(overlay).toBeVisible()
  const legend = page.getByRole('group', { name: 'Legend' })
  for (const name of [
    'Contacts (People)',
    'Projects',
    'Notes & Entries',
    'Tasks',
    'Tags & Topics',
  ]) {
    await expect(legend.getByText(name, { exact: true })).toBeVisible()
  }

  // The approved defaults.
  const size = overlay.getByRole('slider', { name: 'Node size' })
  const width = overlay.getByRole('slider', { name: 'Link width' })
  const glow = overlay.getByRole('slider', { name: 'Glow' })
  await expect(size).toHaveValue('0.8')
  await expect(size).toHaveAttribute('aria-valuetext', '0.8x')
  await expect(width).toHaveValue('0.1')
  await expect(width).toHaveAttribute('aria-valuetext', '0.10')
  await expect(glow).toHaveValue('1')
  await expect(glow).toHaveAttribute('aria-valuetext', '1.0x')
  const stars = overlay.getByRole('button', { name: /^Stars: / })
  await expect(stars).toHaveText('Stars: Dense')

  let before = await settled(canvas)
  const resting = await colouredShare(page, canvas)
  await size.fill('1.6')
  await expect(overlay.getByText('1.6x', { exact: true })).toBeVisible()
  await expect
    .poll(() => colouredShare(page, canvas), { message: 'bigger orbs' })
    .toBeGreaterThan(resting)

  before = await settled(canvas)
  await width.fill('0.4')
  await expect(width).toHaveAttribute('aria-valuetext', '0.40')
  await expect
    .poll(async () => (await shot(canvas)).equals(before), { message: 'thicker links' })
    .toBe(false)

  await settled(canvas)
  const bigger = await colouredShare(page, canvas)
  await glow.fill('0.4')
  await expect(glow).toHaveAttribute('aria-valuetext', '0.4x')
  await expect
    .poll(() => colouredShare(page, canvas), { message: 'less glow' })
    .toBeLessThan(bigger)

  for (const next of ['Sparse', 'Off', 'Dense']) {
    before = await settled(canvas)
    await stars.click()
    await expect(stars).toHaveText(`Stars: ${next}`)
    await expect
      .poll(async () => (await shot(canvas)).equals(before), { message: `stars ${next}` })
      .toBe(false)
  }

  // Each change draws once; nothing loops after them.
  await expect.poll(() => still(page)).toBe(true)
})

test('auto-orbit starts off and turns the view while on', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/map')
  await drawn(page)
  const orbit = overlayOf(page).getByRole('button', { name: 'Auto-orbit' })
  await expect(orbit).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => still(page), { message: 'not turning at first' }).toBe(true)

  const before = await shot(canvasOf(page))
  await orbit.click()
  await expect(orbit).toHaveAttribute('aria-pressed', 'true')
  expect(await still(page), 'turning').toBe(false)
  await expect.poll(async () => (await shot(canvasOf(page))).equals(before)).toBe(false)

  await orbit.click()
  await expect(orbit).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => still(page)).toBe(true)
})

test('auto-orbit is off with reduced motion too', { tag: '@desktop' }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/map')
  await drawn(page)
  await expect(overlayOf(page).getByRole('button', { name: 'Auto-orbit' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect.poll(() => still(page)).toBe(true)
})

test(
  'reset view frames the whole map and clears the selection',
  { tag: '@desktop' },
  async ({ page }) => {
    await page.goto('/map')
    await drawn(page)
    const canvas = canvasOf(page)
    const opening = await settled(canvas)

    const point = await findRecord(page)
    await page.mouse.click(point.x, point.y)
    await expect(mapOf(page)).toHaveAttribute('data-highlight', 'selected')
    // The orbit glides to the record, so the view moves away from the opening one.
    await expect.poll(async () => (await shot(canvas)).equals(opening)).toBe(false)

    await overlayOf(page).getByRole('button', { name: 'Reset view' }).click()
    // Where the pointer was for the opening view, over no record.
    await page.mouse.move(0, 0)
    await expect(mapOf(page)).toHaveAttribute('data-highlight', 'none')
    await expect(statusOf(page)).toHaveText(/^Hover over or select a record/)
    expect((await settled(canvas)).equals(opening), 'back to the opening view').toBe(true)
    await expect.poll(() => still(page)).toBe(true)
  },
)

test('every overlay control works by keyboard', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/map')
  await drawn(page)
  const overlay = overlayOf(page)
  const orbit = overlay.getByRole('button', { name: 'Auto-orbit' })
  const reset = overlay.getByRole('button', { name: 'Reset view' })
  const stars = overlay.getByRole('button', { name: /^Stars: / })
  const size = overlay.getByRole('slider', { name: 'Node size' })
  const width = overlay.getByRole('slider', { name: 'Link width' })
  const glow = overlay.getByRole('slider', { name: 'Glow' })

  // Tab reaches each control in order, and each shows that it has focus.
  await orbit.focus()
  for (const control of [reset, stars, size, width, glow]) {
    await page.keyboard.press('Tab')
    await expect(control).toBeFocused()
    expect(await control.evaluate((el) => el.matches(':focus-visible'))).toBe(true)
  }
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(orbit).toBeFocused()
  const ring = await orbit.evaluate((el) => getComputedStyle(el).boxShadow)
  expect(ring, 'a visible focus ring').not.toBe('none')

  await page.keyboard.press('Space')
  await expect(orbit).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Enter')
  await expect(orbit).toHaveAttribute('aria-pressed', 'false')

  await stars.focus()
  await page.keyboard.press('Enter')
  await expect(stars).toHaveText('Stars: Sparse')

  await size.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(size).toHaveAttribute('aria-valuetext', '1.0x')
  await width.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(width).toHaveAttribute('aria-valuetext', '0.08')
  await glow.focus()
  await page.keyboard.press('End')
  await expect(glow).toHaveAttribute('aria-valuetext', '2.5x')

  const point = await findRecord(page)
  await page.mouse.click(point.x, point.y)
  await expect(mapOf(page)).toHaveAttribute('data-highlight', 'selected')
  await reset.focus()
  await page.keyboard.press('Enter')
  await expect(mapOf(page)).not.toHaveAttribute('data-highlight', 'selected')
})

test('on a phone the controls fold behind one button', { tag: '@phone' }, async ({ page }) => {
  await page.goto('/map')
  await drawn(page)
  const toggle = page.getByRole('button', { name: 'View', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(overlayOf(page)).toBeHidden()

  await toggle.tap()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const overlay = overlayOf(page)
  await expect(overlay).toBeVisible()
  await expect(overlay.getByRole('slider', { name: 'Node size' })).toBeVisible()
  await expect(overlay.getByRole('group', { name: 'Legend' })).toBeVisible()
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  expect(fits, 'no sideways scroll with the panel open').toBe(true)
  const panel = (await overlay.boundingBox())!
  const view = page.viewportSize()!
  expect(panel.x + panel.width).toBeLessThanOrEqual(view.width)

  await overlay.getByRole('button', { name: /^Stars: / }).tap()
  await expect(overlay.getByRole('button', { name: /^Stars: / })).toHaveText('Stars: Sparse')
  await toggle.tap()
  await expect(overlay).toBeHidden()
})
