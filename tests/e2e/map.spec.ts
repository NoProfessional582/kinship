/**
 * The 3D map page (/map): it draws the seeded records, picks a record under the pointer,
 * lights a hovered or selected record's connections and dims the rest, changes live with
 * the overlay's controls (by mouse and by keyboard), opens the inspector for a selection
 * and moves along its connections, reaches any record from the Records list by keyboard
 * alone, and shows its other states: no records, a failed request (and its retry), and a
 * browser without WebGL, which lists the records instead. Leaving the page frees the canvas.
 * The sidebar, the command palette and the phone's More sheet reach it (the phone's own
 * page is /m/map), and `?focus=<type>:<id>` opens it on one record, or on the whole map
 * with a notice when that record is not on it.
 *
 * The Attraction slider lays the map out again, keeping the selection, and the map follows
 * the app's theme: paper by day (Kinship's default), deep space after dark.
 *
 * Headless Chromium draws WebGL in software, so these check that something was drawn and
 * what it looks like broadly (coloured orbs on paper or a dark sky), not exact pixels.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../support/fixtures'
import { withoutWebgl } from '../support/map'
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
 * the sky (near black, or paper by day) and the stars (white, or ink) are grey, so neither
 * counts.
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

test('the map draws the seeded records', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/map')
  await expect(page.getByRole('heading', { level: 1, name: 'Map' })).toHaveCount(1)
  await drawn(page)
  const share = await colouredShare(page, canvasOf(page))
  expect(share, 'coloured orbs and auras on the paper sky').toBeGreaterThan(0.001)
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
  const attraction = overlay.getByRole('slider', { name: 'Attraction' })

  // Tab reaches each control in order, and each shows that it has focus.
  await orbit.focus()
  const order = [reset, stars, size, width, glow, attraction]
  for (const control of order) {
    await page.keyboard.press('Tab')
    await expect(control).toBeFocused()
    expect(await control.evaluate((el) => el.matches(':focus-visible'))).toBe(true)
  }
  for (let i = 0; i < order.length; i++) await page.keyboard.press('Shift+Tab')
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
  await attraction.focus()
  await page.keyboard.press('ArrowRight')
  await expect(attraction).toHaveAttribute('aria-valuetext', '1.10x')
  await expect(mapOf(page)).toHaveAttribute('data-attraction', '1.1', { timeout: 30_000 })

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

interface MapNode {
  id: string
  type: string
  name: string
  subtitle?: string
  description?: string
  url: string | null
}

/** The graph the page draws, and a record's connected records, as the API sends them. */
async function graphOf(page: Page) {
  const response = await page.request.get('/api/graph')
  expect(response.status()).toBe(200)
  const graph = (await response.json()) as {
    nodes: MapNode[]
    links: { source: string; target: string; relation: string }[]
  }
  const byName = (name: string) => {
    const node = graph.nodes.find((n) => n.name === name)
    expect(node, `the graph has ${name}`).toBeTruthy()
    return node!
  }
  const connected = (id: string) => {
    const ids = new Set<string>()
    for (const { source, target } of graph.links) {
      if (source === target) continue
      if (source === id) ids.add(target)
      if (target === id) ids.add(source)
    }
    return graph.nodes.filter((n) => ids.has(n.id))
  }
  return { graph, byName, connected }
}

const inspectorOf = (page: Page) => page.getByTestId('map-inspector')
const recordsButton = (page: Page) => page.getByRole('button', { name: 'Records', exact: true })
const pickerOf = (page: Page) => page.getByRole('dialog', { name: 'Records' })

/** Selects a record by name through the Records list. */
async function pick(page: Page, name: string) {
  await recordsButton(page).click()
  const picker = pickerOf(page)
  await expect(picker).toBeVisible()
  await picker.getByRole('searchbox', { name: 'Filter records by name' }).fill(name)
  await picker
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .first()
    .click()
  await expect(picker).toBeHidden()
}

test(
  'selecting a record opens the inspector with its details and connections',
  { tag: '@desktop' },
  async ({ page }) => {
    await page.goto('/map')
    await drawn(page)
    const { byName, connected } = await graphOf(page)
    const maya = byName(SEEDED.contact)

    await pick(page, SEEDED.contact)
    await expect(mapOf(page)).toHaveAttribute('data-active-id', maya.id)
    const inspector = inspectorOf(page)
    await expect(inspector).toBeVisible()
    const heading = inspector.getByRole('heading', { level: 2, name: SEEDED.contact })
    await expect(heading).toBeFocused()
    await expect(inspector).toContainText('Contact')
    if (maya.subtitle) await expect(inspector).toContainText(maya.subtitle)
    if (maya.description) await expect(inspector).toContainText(maya.description)
    await expect(inspector.getByRole('link', { name: 'Open record' })).toHaveAttribute(
      'href',
      maya.url!,
    )

    // One button per connected record, matching the status line's count.
    const others = connected(maya.id)
    const rows = inspector.getByRole('listitem').getByRole('button')
    await expect(rows).toHaveCount(others.length)
    await expect(inspector.getByRole('heading', { level: 3 })).toHaveText(
      `Connections (${others.length})`,
    )
    await expect(statusOf(page)).toHaveText(
      `Selected: ${SEEDED.contact} · ${others.length} direct connection${others.length === 1 ? '' : 's'}`,
    )
    // The note mentions Maya: an incoming link, read with its stored relation.
    const note = inspector.getByRole('button', { name: new RegExp(`^${SEEDED.note}`) })
    await expect(note).toContainText('← mentions')
    await expect(note).toHaveAccessibleName(/mentions, to this record/)

    // The legend steps aside rather than sit under the drawer.
    const legend = page.getByRole('group', { name: 'Legend' }).last()
    const [a, b] = [(await legend.boundingBox())!, (await inspector.boundingBox())!]
    expect(a.x + a.width, 'the legend ends left of the drawer').toBeLessThanOrEqual(b.x)

    // The view's centre moves left by half the drawer, so the selection is not behind it.
    const host = page.getByTestId('graph-canvas')
    const area = (await host.boundingBox())!
    const half = Math.round((area.x + area.width - b.x) / 2)
    await expect
      .poll(async () => (await host.getAttribute('data-view-shift'))?.split(',').map(Number))
      .toEqual([expect.closeTo(half, 0), 0])

    // The close button clears the selection, and the view's centre goes back.
    await inspector.getByRole('button', { name: 'Close details' }).click()
    await expect(inspector).toBeHidden()
    await expect(host).toHaveAttribute('data-view-shift', '0,0')
    await expect(mapOf(page)).toHaveAttribute('data-highlight', 'none')
  },
)

test(
  'a connection in the inspector selects that record; a click on the map opens it too',
  { tag: '@desktop' },
  async ({ page }) => {
    await page.goto('/map')
    await drawn(page)
    const { byName } = await graphOf(page)
    const note = byName(SEEDED.note)

    await pick(page, SEEDED.contact)
    const inspector = inspectorOf(page)
    await inspector.getByRole('button', { name: new RegExp(`^${SEEDED.note}`) }).click()
    await expect(mapOf(page)).toHaveAttribute('data-active-id', note.id)
    await expect(inspector.getByRole('heading', { level: 2 })).toHaveText(SEEDED.note)
    await expect(inspector.getByRole('heading', { level: 2 })).toBeFocused()
    await expect(statusOf(page)).toHaveText(new RegExp(`^Selected: ${SEEDED.note} · `))
    // Back to Maya from the note's side, where the same link points out.
    await expect(
      inspector.getByRole('button', { name: new RegExp(`^${SEEDED.contact}`) }),
    ).toContainText('→ mentions')
    await inspector.getByRole('button', { name: new RegExp(`^${SEEDED.contact}`) }).click()
    await expect(inspector.getByRole('heading', { level: 2 })).toHaveText(SEEDED.contact)

    await page.keyboard.press('Escape')
    await expect(inspector).toBeHidden()
    await expect.poll(() => still(page)).toBe(true)
    const point = await findRecord(page)
    const hovered = await mapOf(page).getAttribute('data-active-id')
    await page.mouse.click(point.x, point.y)
    await expect(inspector).toBeVisible()
    await expect(mapOf(page)).toHaveAttribute('data-active-id', hovered!)
  },
)

test('a tag shows its connections and no record link', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/map')
  await drawn(page)
  const { graph, connected } = await graphOf(page)
  const tag = graph.nodes.find((n) => n.type === 'tag' && connected(n.id).length > 0)!
  await pick(page, tag.name)
  const inspector = inspectorOf(page)
  await expect(inspector.getByRole('heading', { level: 2 })).toHaveText(tag.name)
  await expect(inspector).toContainText('Tag')
  await expect(inspector.getByRole('link')).toHaveCount(0)
  await expect(inspector.getByRole('listitem')).toHaveCount(connected(tag.id).length)
})

test('"Open record" goes to the record’s page', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/map')
  await drawn(page)
  const { byName } = await graphOf(page)
  const maya = byName(SEEDED.contact)
  await pick(page, SEEDED.contact)
  await inspectorOf(page).getByRole('link', { name: 'Open record' }).click()
  await expect(page).toHaveURL(new RegExp(`${maya.url!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
  await expect(page.getByRole('heading', { level: 1, name: SEEDED.contact })).toBeVisible()
})

test(
  'the map can be explored by keyboard alone, from the Records list',
  { tag: '@desktop' },
  async ({ page }) => {
    await page.goto('/map')
    await drawn(page)
    const records = recordsButton(page)
    await expect(records).toBeVisible()
    // Tab reaches the Records button.
    await page.locator('body').focus()
    for (
      let i = 0;
      i < 40 && !(await records.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press('Tab')
    }
    await expect(records).toBeFocused()
    expect(await records.evaluate((el) => el.matches(':focus-visible'))).toBe(true)

    await page.keyboard.press('Enter')
    const picker = pickerOf(page)
    await expect(picker).toBeVisible()
    const filter = picker.getByRole('searchbox', { name: 'Filter records by name' })
    await expect(filter).toBeFocused()
    await page.keyboard.type(SEEDED.contact.toLowerCase())
    await expect(picker.getByText(/^[1-9]\d* records?$/)).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(
      picker.getByRole('button', { name: new RegExp(`^${SEEDED.contact}`) }),
    ).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(picker).toBeHidden()

    const inspector = inspectorOf(page)
    const heading = inspector.getByRole('heading', { level: 2 })
    await expect(heading).toHaveText(SEEDED.contact)
    await expect(heading).toBeFocused()
    // Tab: close, Open record, then the connections.
    await page.keyboard.press('Tab')
    await expect(inspector.getByRole('button', { name: 'Close details' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(inspector.getByRole('link', { name: 'Open record' })).toBeFocused()
    const note = inspector.getByRole('button', { name: new RegExp(`^${SEEDED.note}`) })
    for (let i = 0; i < 20 && !(await note.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press('Tab')
    }
    await expect(note).toBeFocused()
    expect(await note.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')
    await page.keyboard.press('Enter')
    await expect(heading).toHaveText(SEEDED.note)
    await expect(heading).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(inspector).toBeHidden()
    await expect(records).toBeFocused()
  },
)

test(
  'Escape closes the Records list and keeps the selection',
  { tag: '@desktop' },
  async ({ page }) => {
    await page.goto('/map')
    await drawn(page)
    await pick(page, SEEDED.contact)
    await recordsButton(page).click()
    await expect(pickerOf(page)).toBeVisible()
    // Even with text in the filter, one Escape closes the list.
    await page.keyboard.type('zz')
    await page.keyboard.press('Escape')
    await expect(pickerOf(page)).toBeHidden()
    await expect(inspectorOf(page)).toBeVisible()
    await expect(mapOf(page)).toHaveAttribute('data-highlight', 'selected')
    await expect(recordsButton(page)).toBeFocused()
  },
)

test(
  'on a phone the inspector is a bottom sheet that leaves the controls free',
  { tag: '@phone' },
  async ({ page }) => {
    await page.goto('/map')
    await drawn(page)
    const point = await findRecord(page)
    await page.touchscreen.tap(point.x, point.y)
    await expect(mapOf(page)).toHaveAttribute('data-highlight', 'selected')
    const inspector = inspectorOf(page)
    await expect(inspector).toBeVisible()

    const view = page.viewportSize()!
    const sheet = (await inspector.boundingBox())!
    expect(sheet.x).toBeGreaterThanOrEqual(0)
    expect(sheet.x + sheet.width).toBeLessThanOrEqual(view.width + 0.5)
    expect(sheet.y + sheet.height, 'along the bottom').toBeGreaterThan(view.height - 2)
    expect(sheet.height, 'leaves the top of the map').toBeLessThanOrEqual(view.height * 0.6)
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    )
    expect(fits, 'no sideways scroll with the sheet open').toBe(true)
    // The view's centre rises by half the sheet, so the selection shows above it.
    const host = page.getByTestId('graph-canvas')
    const half = Math.round((view.height - sheet.y) / 2)
    await expect
      .poll(async () => (await host.getAttribute('data-view-shift'))?.split(',').map(Number))
      .toEqual([0, expect.closeTo(half, 0)])

    // The controls stay above the sheet and usable.
    const toggle = page.getByRole('button', { name: 'View', exact: true })
    for (const control of [toggle, recordsButton(page)]) {
      const box = (await control.boundingBox())!
      expect(box.y + box.height).toBeLessThan(sheet.y)
    }
    await recordsButton(page).tap()
    await expect(pickerOf(page)).toBeVisible()
    const list = (await pickerOf(page).boundingBox())!
    expect(list.x + list.width).toBeLessThanOrEqual(view.width)
    await pickerOf(page).getByRole('button', { name: 'Close records' }).tap()

    // A connection is a tap away, and the close button clears the selection.
    const first = inspector.getByRole('listitem').getByRole('button').first()
    if (await first.count()) {
      await first.tap()
      await expect(mapOf(page)).toHaveAttribute('data-highlight', 'selected')
    }
    await inspector.getByRole('button', { name: 'Close details' }).tap()
    await expect(inspector).toBeHidden()
    await expect(mapOf(page)).toHaveAttribute('data-highlight', 'none')
    await expect(host).toHaveAttribute('data-view-shift', '0,0')
  },
)

const NOT_ON_MAP = 'That record is not on the map. It may have been deleted.'
const noticeOf = (page: Page) => page.getByTestId('map-notice')
const focusLink = (id: string, base = '/map') => `${base}?${new URLSearchParams({ focus: id })}`

test('the sidebar and the command palette go to the map', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/')
  const link = page.getByRole('complementary').getByRole('link', { name: 'Map', exact: true })
  await link.click()
  await expect(page).toHaveURL(/\/map$/)
  await drawn(page)
  await expect(link).toHaveAttribute('aria-current', 'page')

  await page.goto('/contacts')
  await page.getByRole('heading', { level: 1, name: 'Contacts' }).waitFor()
  await page.keyboard.press('Control+k')
  await page.getByRole('option', { name: 'Go to map' }).click()
  await expect(page).toHaveURL(/\/map$/)
  await drawn(page)
})

test(
  'a focus link opens the map on that record, and picking others keeps the link',
  { tag: '@desktop' },
  async ({ page }) => {
    const { byName } = await graphOf(page)
    const maya = byName(SEEDED.contact)
    const link = focusLink(maya.id)
    await page.goto(link)
    await drawn(page)
    const inspector = inspectorOf(page)
    await expect(inspector.getByRole('heading', { level: 2, name: SEEDED.contact })).toBeVisible()
    await expect(mapOf(page)).toHaveAttribute('data-active-id', maya.id)
    await expect(noticeOf(page)).toHaveCount(0)
    // Centred as a pick from the Records list is: the view makes room for the drawer.
    const host = page.getByTestId('graph-canvas')
    await expect
      .poll(async () => Number((await host.getAttribute('data-view-shift'))?.split(',')[0]))
      .toBeGreaterThan(0)

    await inspector.getByRole('button', { name: new RegExp(`^${SEEDED.note}`) }).click()
    await expect(inspector.getByRole('heading', { level: 2 })).toHaveText(SEEDED.note)
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(link)
  },
)

test(
  'a focus that is not on the map shows the whole map with a notice',
  { tag: '@desktop' },
  async ({ page }) => {
    // Missing (and so also trashed: the map answers the same), an unknown type, blank.
    for (const focus of ['contact:no-such-record', 'person:1', 'nonsense', '']) {
      await page.goto(focusLink(focus))
      await drawn(page)
      await expect(noticeOf(page), `focus=${focus}`).toHaveText(NOT_ON_MAP)
      await expect(inspectorOf(page)).toBeHidden()
      await expect(mapOf(page)).toHaveAttribute('data-highlight', 'none')
    }
    await noticeOf(page).getByRole('button', { name: 'Dismiss' }).click()
    await expect(noticeOf(page)).toBeHidden()
    // The map is all there and works as ever.
    await pick(page, SEEDED.contact)
    await expect(inspectorOf(page)).toBeVisible()
  },
)

test(
  'on a phone, More and search reach the map, which fills the space between the bars',
  { tag: '@phone' },
  async ({ page }) => {
    await page.goto('/m')
    await page.getByRole('button', { name: 'More', exact: true }).tap()
    await page.getByRole('link', { name: 'Map', exact: true }).tap()
    await expect(page).toHaveURL(/\/m\/map$/)
    await drawn(page)

    const header = (await page.getByRole('banner').boundingBox())!
    const tabs = (await page.getByRole('navigation').boundingBox())!
    const map = (await mapOf(page).boundingBox())!
    expect(map.y).toBeCloseTo(header.y + header.height, 0)
    expect(map.y + map.height).toBeCloseTo(tabs.y, 0)
    expect(map.width).toBeCloseTo(page.viewportSize()!.width, 0)
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    )
    expect(fits, 'no sideways scroll').toBe(true)

    await page.goto('/m/contacts')
    await page.getByRole('button', { name: 'Search', exact: true }).tap()
    await page.getByRole('option', { name: 'Go to map' }).tap()
    await expect(page).toHaveURL(/\/m\/map$/)
    await drawn(page)
  },
)

test(
  'a focus link on the phone opens the sheet above the tab bar, linking within /m',
  { tag: '@phone' },
  async ({ page }) => {
    const { byName } = await graphOf(page)
    const maya = byName(SEEDED.contact)
    await page.goto(focusLink(maya.id, '/m/map'))
    await drawn(page)
    const inspector = inspectorOf(page)
    await expect(inspector.getByRole('heading', { level: 2, name: SEEDED.contact })).toBeVisible()
    const sheet = (await inspector.boundingBox())!
    const tabs = (await page.getByRole('navigation').boundingBox())!
    expect(sheet.y + sheet.height, 'the sheet ends above the tab bar').toBeLessThanOrEqual(
      tabs.y + 0.5,
    )
    await expect(statusOf(page)).toBeInViewport()

    const open = inspector.getByRole('link', { name: 'Open record' })
    await expect(open).toHaveAttribute('href', `/m${maya.url!}`)
    await open.tap()
    await expect(page).toHaveURL(
      new RegExp(`/m${maya.url!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    )
    await expect(page.getByRole('heading', { level: 1, name: SEEDED.contact })).toBeVisible()

    await page.goto('/m/map?focus=contact:no-such-record')
    await drawn(page)
    await expect(noticeOf(page)).toHaveText(NOT_ON_MAP)
    await expect(inspectorOf(page)).toBeHidden()
  },
)

/**
 * The lightness of an element's text colour, 0 to 100, however the browser writes it:
 * Tailwind's palette comes back as lab(), the app's own palette as rgb().
 */
async function textLightness(target: Locator): Promise<number> {
  return target.evaluate((el) => {
    const color = getComputedStyle(el).color
    const lab = /^lab\(([\d.]+)/.exec(color)
    if (lab) return Number(lab[1])
    const [r, g, b] = color.match(/[\d.]+/g)!.map(Number)
    return (r + g + b) / 3 / 2.55
  })
}

/** The mean brightness of the element's pixels, 0 to 255: paper is bright, space dark. */
async function brightness(page: Page, target: Locator): Promise<number> {
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
    let sum = 0
    for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3
    return sum / (data.length / 4)
  }, png.toString('base64'))
}

test(
  'Attraction lays the map out again, keeping the selection and the view',
  { tag: '@desktop' },
  async ({ page }) => {
    // A still beacon, so the view settles between screenshots.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/map')
    await drawn(page)
    const overlay = overlayOf(page)
    const attraction = overlay.getByRole('slider', { name: 'Attraction' })
    await expect(attraction).toHaveValue('1')
    await expect(attraction).toHaveAttribute('aria-valuetext', '1.00x')
    await expect(mapOf(page)).toHaveAttribute('data-attraction', '1')

    await pick(page, SEEDED.contact)
    const inspector = inspectorOf(page)
    await expect(inspector.getByRole('heading', { level: 2, name: SEEDED.contact })).toBeVisible()
    const active = await mapOf(page).getAttribute('data-active-id')
    const before = await settled(canvasOf(page))
    const firstDraws = await page.evaluate(
      () => performance.getEntriesByName('graph:first-draw').length,
    )

    // Pulled tight: laid out again (a new scene drawn), still selected, the panel still open.
    await attraction.fill('2.5')
    await expect(overlay.getByText('2.50x', { exact: true })).toBeVisible()
    await expect(mapOf(page)).toHaveAttribute('data-attraction', '2.5', { timeout: 30_000 })
    await expect(mapOf(page)).not.toHaveAttribute('aria-busy', 'true')
    await expect
      .poll(() => page.evaluate(() => performance.getEntriesByName('graph:first-draw').length))
      .toBeGreaterThan(firstDraws)
    await expect(mapOf(page)).toHaveAttribute('data-active-id', active!)
    await expect(mapOf(page)).toHaveAttribute('data-highlight', 'selected')
    await expect(inspector.getByRole('heading', { level: 2, name: SEEDED.contact })).toBeVisible()
    await expect(statusOf(page)).toContainText(SEEDED.contact)
    const after = await settled(canvasOf(page))
    expect(after.equals(before), 'the records moved').toBe(false)

    // Reset view still frames the whole graph, now in its new arrangement.
    await overlay.getByRole('button', { name: 'Reset view' }).click()
    await expect(mapOf(page)).not.toHaveAttribute('data-highlight', 'selected')
    await expect(mapOf(page)).toHaveAttribute('data-attraction', '2.5')
  },
)

test('the map follows the app theme, keeping its view', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/map')
  await drawn(page)
  const canvas = canvasOf(page)
  // Kinship's default is light: the palette's paper, behind the canvas and in it.
  await expect(mapOf(page)).toHaveCSS('background-color', 'rgb(245, 242, 235)')
  expect(await brightness(page, canvas), 'a paper sky').toBeGreaterThan(200)
  expect(await colouredShare(page, canvas), 'coloured orbs on paper').toBeGreaterThan(0.001)
  const overlay = overlayOf(page)
  expect(await textLightness(overlay), 'ink on the paper glass').toBeLessThan(30)

  await page.getByRole('button', { name: 'Theme' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(mapOf(page)).toHaveCSS('background-color', 'rgb(8, 10, 14)')
  await expect.poll(() => brightness(page, canvas), { message: 'deep space' }).toBeLessThan(60)
  expect(await colouredShare(page, canvas), 'coloured orbs on the dark sky').toBeGreaterThan(0.001)
  await expect
    .poll(() => textLightness(overlay), { message: 'light text on the dark glass' })
    .toBeGreaterThan(80)

  // A selection and its panel stay through a change of theme.
  await pick(page, SEEDED.contact)
  await expect(mapOf(page)).toHaveAttribute('data-highlight', 'selected')
  await page.getByRole('button', { name: 'Theme' }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect.poll(() => brightness(page, canvas), { message: 'paper again' }).toBeGreaterThan(200)
  await expect(mapOf(page)).toHaveAttribute('data-highlight', 'selected')
  await expect(inspectorOf(page)).toBeVisible()
  expect(await textLightness(overlay), 'ink again').toBeLessThan(30)
})

test('the wheel zooms towards the pointer', { tag: '@desktop' }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/map')
  await drawn(page)
  const canvas = canvasOf(page)
  const box = (await canvas.boundingBox())!
  const point = await findRecord(page)
  const record = await mapOf(page).getAttribute('data-active-id')
  expect(record).toBeTruthy()
  // Far enough from the middle that a zoom to the middle would carry it away.
  const off = Math.hypot(point.x - (box.x + box.width / 2), point.y - (box.y + box.height / 2))
  expect(off, 'a record away from the middle').toBeGreaterThan(box.height * 0.15)

  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -200)
  await settled(canvas)
  // Off and back again, so the map looks under the pointer afresh.
  const empty = await emptySpace(page)
  await page.mouse.move(empty.x, empty.y)
  await expect(mapOf(page)).toHaveAttribute('data-active-id', '')
  await page.mouse.move(point.x, point.y)
  await expect(mapOf(page)).toHaveAttribute('data-active-id', record!)
})
