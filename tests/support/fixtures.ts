/**
 * The page fixture every browser test uses.
 *
 * - Any uncaught error, console error, failed request or error response (400 and up) on a
 *   page fails the test that loaded it, so a page that renders but logs an error still
 *   fails. The one exception: the Next router cancelling its own prefetches, which shows
 *   as an aborted request carrying `next-router-prefetch`.
 * - The stack's network has no way out, so the Google Fonts stylesheet (app/layout.tsx) is
 *   answered here with an empty one: the pages fall back to their system fonts.
 */
import { test as base, expect } from '@playwright/test'
import { withCleanup, type Cleanup } from './api'

export const test = base.extend<{ problems: string[]; cleanup: Cleanup }>({
  cleanup: async ({ request }, use) => withCleanup(request, use),
  problems: [
    async ({ page, context }, use) => {
      const problems: string[] = []
      await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
        route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
      )
      page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console error: ${message.text()}`)
      })
      page.on('requestfailed', (request) => {
        const reason = request.failure()?.errorText
        if (reason === 'net::ERR_ABORTED' && request.headers()['next-router-prefetch']) return
        problems.push(`request failed: ${request.method()} ${request.url()} (${reason})`)
      })
      page.on('response', (response) => {
        if (response.status() >= 400) {
          problems.push(
            `error response: ${response.status()} ${response.request().method()} ${response.url()}`,
          )
        }
      })
      await use(problems)
      expect(problems, 'errors on the page').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
