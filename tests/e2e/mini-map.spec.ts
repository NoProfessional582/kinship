/**
 * The small map on contact and project pages (components/graph/mini-graph.tsx): the
 * record's neighbourhood up to two links away, drawn only once the card scrolls into view,
 * with "Open in map" and a picked record both opening the full map focused. Its other
 * states: no connections, a failed request (and its retry), a record the map no longer has,
 * and no WebGL (a list of links). On a phone the links stay within /m and a vertical swipe
 * over the card scrolls the page. Leaving the page, or deleting the record, frees the canvas
 * without asking for the record again. It follows the app's theme, as the full map does.
 */
import type { Page } from '@playwright/test'
import { test, expect } from '../support/fixtures'
import { newContact } from '../support/api'
import { withoutWebgl } from '../support/map'
import { SEEDED } from '../support/stack'

interface MapNode {
  id: string
  type: string
  name: string
  url: string | null
}
interface MapGraph {
  nodes: MapNode[]
  links: { source: string; target: string }[]
}

const cardOf = (page: Page) => page.getByTestId('mini-map')
const canvasOf = (page: Page) => cardOf(page).getByTestId('graph-canvas').locator('canvas')
const captionOf = (page: Page) => page.getByTestId('mini-map-caption')
const inspectorOf = (page: Page) => page.getByTestId('map-inspector')

const focusQuery = (id: string) => `/api/graph?${new URLSearchParams({ focusId: id, depth: '2' })}`
const isFocusRequest = (url: URL) =>
  url.pathname === '/api/graph' && url.searchParams.has('focusId')

/** A seeded record as the full map has it: its id and its page. */
async function recordNamed(page: Page, name: string) {
  const response = await page.request.get('/api/graph')
  expect(response.status()).toBe(200)
  const node = ((await response.json()) as MapGraph).nodes.find((n) => n.name === name)
  expect(node, `the graph has ${name}`).toBeTruthy()
  return node!
}

/** The record's neighbourhood, as the card asks for it. */
async function neighbourhoodOf(page: Page, id: string) {
  const response = await page.request.get(focusQuery(id))
  expect(response.status()).toBe(200)
  return (await response.json()) as MapGraph
}

/** Scrolls the card into view and waits for its first frame. */
async function drawn(page: Page) {
  await cardOf(page).scrollIntoViewIfNeeded()
  await expect(canvasOf(page)).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => performance.getEntriesByName('graph:first-draw').length))
    .toBeGreaterThan(0)
}

/**
 * Puts the mouse over the page's own record: the small map's orbit centres on it, so it is
 * in the middle of the view once the glide there ends. Returns where.
 */
async function overOwnRecord(page: Page) {
  const canvas = canvasOf(page)
  const box = (await canvas.boundingBox())!
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await expect
    .poll(async () => {
      // Moved off and back, so each try is a fresh hover over the settled view.
      await page.mouse.move(box.x + 2, box.y + 2)
      await page.mouse.move(point.x, point.y)
      return canvas.evaluate((el) => el.style.cursor)
    })
    .toBe('pointer')
  return point
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const mapUrl = (id: string, base = '/map') =>
  new RegExp(`${escaped(`${base}?${new URLSearchParams({ focus: id })}`)}$`)

test(
  'a contact page maps its neighbourhood, and "Open in map" opens the map on it',
  { tag: '@desktop' },
  async ({ page }) => {
    const maya = await recordNamed(page, SEEDED.contact)
    const { nodes } = await neighbourhoodOf(page, maya.id)
    expect(nodes.length, 'the seeded contact has connections').toBeGreaterThan(1)

    await page.goto(maya.url!)
    const card = cardOf(page)
    await expect(card).toHaveAccessibleName(`Map around ${SEEDED.contact}`)
    await expect(card.getByRole('heading', { level: 3, name: 'Map' })).toBeVisible()
    await drawn(page)
    await expect(captionOf(page)).toHaveText(`${nodes.length - 1} records within two links`)
    // The canvas is no tab stop: the link is the keyboard's way in.
    await expect(canvasOf(page)).not.toHaveAttribute('tabindex', /.*/)

    const open = card.getByRole('link', { name: 'Open in map' })
    await expect(open).toHaveAttribute('href', `/map?${new URLSearchParams({ focus: maya.id })}`)
    await open.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(mapUrl(maya.id))
    await expect(
      inspectorOf(page).getByRole('heading', { level: 2, name: SEEDED.contact }),
    ).toBeVisible()
  },
)

test(
  'the project page draws its map only once it is scrolled to',
  { tag: '@desktop' },
  async ({ page }) => {
    const project = await recordNamed(page, SEEDED.project)
    const { nodes } = await neighbourhoodOf(page, project.id)
    const asked: string[] = []
    page.on('request', (request) => {
      if (isFocusRequest(new URL(request.url()))) asked.push(request.url())
    })

    await page.goto(project.url!)
    await expect(page.getByRole('heading', { level: 1, name: SEEDED.project })).toBeVisible()
    // Below the board, which fills the view: nothing asked for, nothing drawn.
    await expect(cardOf(page)).toBeAttached()
    await expect(cardOf(page)).not.toBeInViewport()
    await page.waitForTimeout(500)
    expect(asked, 'no request before the card is in view').toEqual([])
    await expect(page.locator('canvas')).toHaveCount(0)

    await drawn(page)
    expect(asked).toHaveLength(1)
    await expect(cardOf(page).getByRole('heading', { level: 2, name: 'Map' })).toBeVisible()
    await expect(captionOf(page)).toHaveText(`${nodes.length - 1} records within two links`)
  },
)

test(
  'picking a record on the small map opens the full map on it',
  { tag: '@desktop' },
  async ({ page }) => {
    const maya = await recordNamed(page, SEEDED.contact)
    const { nodes } = await neighbourhoodOf(page, maya.id)
    await page.goto(maya.url!)
    await drawn(page)
    const point = await overOwnRecord(page)
    // The caption names the record under the pointer.
    const name = (await captionOf(page).textContent())!
    const picked = nodes.filter((n) => n.name === name)
    expect(picked, `one record in the neighbourhood is called ${name}`).toHaveLength(1)

    await page.mouse.click(point.x, point.y)
    await expect(page).toHaveURL(mapUrl(picked[0].id))
    await expect(inspectorOf(page).getByRole('heading', { level: 2, name })).toBeVisible()
  },
)

test(
  'a record with no connections says so, and deleting it asks for nothing more',
  { tag: '@desktop' },
  async ({ page, request, cleanup }) => {
    const lone = await newContact(request, cleanup)
    await page.goto(`/contacts/${lone.id}`)
    const card = cardOf(page)
    await card.scrollIntoViewIfNeeded()
    await expect(card.getByText(/^No connections yet/)).toBeVisible()
    await expect(page.locator('canvas')).toHaveCount(0)

    // The fixture fails the test on any 404: the card's request must not be asked again.
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByTitle('Delete contact', { exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Contacts' })).toBeVisible()
  },
)

test(
  'a failed request shows an error on the card, and trying again draws it',
  { tag: '@desktop' },
  async ({ page, refusals }) => {
    const maya = await recordNamed(page, SEEDED.contact)
    refusals.push({ status: 400, method: 'GET', path: focusQuery(maya.id) })
    let fail = true
    await page.route(isFocusRequest, (route) =>
      fail
        ? route.fulfill({ status: 400, json: { error: 'Refused for the test' } })
        : route.continue(),
    )
    await page.goto(maya.url!)
    const card = cardOf(page)
    await card.scrollIntoViewIfNeeded()
    await expect(card.getByRole('alert')).toContainText('The map could not load your records.')
    fail = false
    await card.getByRole('button', { name: 'Try again' }).click()
    await drawn(page)
  },
)

test(
  'a record the map no longer has hides the card',
  { tag: '@desktop' },
  async ({ page, refusals }) => {
    const maya = await recordNamed(page, SEEDED.contact)
    refusals.push({ status: 404, method: 'GET', path: focusQuery(maya.id) })
    await page.route(isFocusRequest, (route) =>
      route.fulfill({ status: 404, json: { error: 'Not found' } }),
    )
    await page.goto(maya.url!)
    await cardOf(page).scrollIntoViewIfNeeded()
    await expect(cardOf(page)).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: SEEDED.contact })).toBeVisible()
  },
)

test(
  'without WebGL the card lists the direct connections as links',
  { tag: '@desktop' },
  async ({ page }) => {
    await withoutWebgl(page)
    const project = await recordNamed(page, SEEDED.project)
    const { nodes, links } = await neighbourhoodOf(page, project.id)
    const direct = new Set(
      links
        .filter((l) => l.source !== l.target)
        .flatMap((l) =>
          l.source === project.id ? [l.target] : l.target === project.id ? [l.source] : [],
        ),
    )
    await page.goto(project.url!)
    const card = cardOf(page)
    await card.scrollIntoViewIfNeeded()
    await expect(card.getByRole('note')).toContainText('The map needs WebGL')
    await expect(page.locator('canvas')).toHaveCount(0)
    const items = page.getByTestId('mini-map-list').getByRole('listitem')
    await expect(items).toHaveCount(Math.min(direct.size, 8))

    // The kickoff note names the project, so it is a direct connection with a page.
    const note = nodes.find((n) => n.name === SEEDED.note)!
    expect(direct.has(note.id), 'the seeded project is linked to the seeded note').toBe(true)
    const link = card.getByRole('link', { name: SEEDED.note, exact: true })
    await expect(link).toHaveAttribute('href', note.url!)
    await link.click()
    await expect(page).toHaveURL(new RegExp(`${escaped(note.url!)}$`))
  },
)

test('the small map follows the app theme', { tag: '@desktop' }, async ({ page }) => {
  const maya = await recordNamed(page, SEEDED.contact)
  await page.goto(maya.url!)
  await drawn(page)
  const surface = cardOf(page).getByTestId('graph-canvas').locator('..')
  await expect(surface).toHaveCSS('background-color', 'rgb(245, 242, 235)')
  await page.getByRole('button', { name: 'Theme' }).click()
  await expect(surface).toHaveCSS('background-color', 'rgb(8, 10, 14)')
  // The palette's light ink, as on the rest of the app after dark.
  await expect
    .poll(() => captionOf(page).evaluate((el) => getComputedStyle(el).color))
    .toBe('rgb(241, 236, 226)')
})

test('leaving the page frees the small map', { tag: '@desktop' }, async ({ page }) => {
  const maya = await recordNamed(page, SEEDED.contact)
  await page.goto(maya.url!)
  await drawn(page)
  // In-app navigation, so the page unmounts rather than unloads.
  await page.getByRole('link', { name: 'Contacts' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Contacts' })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
})

test(
  'on a phone the card fits, links within /m, and a tap opens the phone map',
  { tag: '@phone' },
  async ({ page }) => {
    const maya = await recordNamed(page, SEEDED.contact)
    await page.goto(`/m${maya.url!}`)
    await drawn(page)
    const card = cardOf(page)
    await expect(card.getByRole('heading', { level: 2, name: 'Map' })).toBeVisible()
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    )
    expect(fits, 'no sideways scroll').toBe(true)
    await expect(card.getByRole('link', { name: 'Open in map' })).toHaveAttribute(
      'href',
      `/m/map?${new URLSearchParams({ focus: maya.id })}`,
    )

    // A tap picks: the phone's own map opens on the tapped record.
    const { nodes } = await neighbourhoodOf(page, maya.id)
    const point = await overOwnRecord(page)
    const name = (await captionOf(page).textContent())!
    const picked = nodes.filter((n) => n.name === name)
    expect(picked).toHaveLength(1)
    await page.touchscreen.tap(point.x, point.y)
    await expect(page).toHaveURL(mapUrl(picked[0].id, '/m/map'))
    await expect(inspectorOf(page).getByRole('heading', { level: 2, name })).toBeVisible()
  },
)

test(
  'on a phone the project page fits its card, and a vertical swipe over a card scrolls the page',
  { tag: '@phone' },
  async ({ page }) => {
    const project = await recordNamed(page, SEEDED.project)
    await page.goto(`/m${project.url!}`)
    await drawn(page)
    await expect(cardOf(page).getByRole('heading', { level: 2, name: 'Map' })).toBeVisible()
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    )
    expect(fits, 'no sideways scroll').toBe(true)

    // The contact's page runs on past the card (its timeline); with the card at the top of
    // the view, the page has scrolled, and can scroll back.
    const maya = await recordNamed(page, SEEDED.contact)
    await page.goto(`/m${maya.url!}`)
    await drawn(page)
    await cardOf(page).evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.waitForTimeout(200)
    const box = (await canvasOf(page).boundingBox())!
    const x = box.x + box.width / 2
    // A finger moving down over the card: the page scrolls back up, the card with it.
    const cdp = await page.context().newCDPSession(page)
    const at = (y: number) => [{ x, y }]
    const top = box.y + 20
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(top) })
    for (let y = top + 10; y <= top + 180; y += 10) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(y) })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(async () => (await cardOf(page).boundingBox())!.y).toBeGreaterThan(box.y + 50)
  },
)
