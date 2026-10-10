/**
 * An id that names no record: the API refuses it with a 404, once (no retries), and the page
 * says so, with a way back to its list, on a desktop and under /m on a phone. The refusal is
 * the only error allowed on the page (support/fixtures.ts, `refusals`).
 */
import { test, expect } from '../support/fixtures'

const UNKNOWN = 'no-such-record'

const DETAIL = [
  { what: 'Contact', page: '/contacts', api: '/api/contacts', back: 'Contacts' },
  { what: 'Note', page: '/notes', api: '/api/entries', back: 'Notes' },
  { what: 'Project', page: '/projects', api: '/api/projects', back: 'Projects' },
]

const GUI = [
  { tag: '@desktop', prefix: '' },
  { tag: '@phone', prefix: '/m' },
]

for (const { tag, prefix } of GUI) {
  for (const detail of DETAIL) {
    const path = `${prefix}${detail.page}/${UNKNOWN}`
    test(
      `${path} says the ${detail.what.toLowerCase()} is not found`,
      { tag },
      async ({ page, refusals }) => {
        refusals.push({ status: 404, method: 'GET', path: `${detail.api}/${UNKNOWN}` })
        await page.goto(path)

        const heading = page.getByRole('heading', { level: 1, name: `${detail.what} not found` })
        await expect(heading).toBeVisible()
        await expect(
          page.getByText('It may have been deleted, or the link is wrong.'),
        ).toBeVisible()

        // The way back sits with the message, apart from the app's own navigation.
        await heading.locator('..').getByRole('link', { name: detail.back }).click()
        await expect(page).toHaveURL(`${prefix}${detail.page}`)
      },
    )
  }
}

test(
  '/board?task=<unknown> says the task is not found',
  { tag: '@desktop' },
  async ({ page, refusals }) => {
    refusals.push({ status: 404, method: 'GET', path: `/api/tasks/${UNKNOWN}` })
    await page.goto(`/board?task=${UNKNOWN}`)

    const dialog = page.getByRole('dialog', { name: 'Task not found' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('It may have been deleted, or the link is wrong.')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL('/board')
  },
)
