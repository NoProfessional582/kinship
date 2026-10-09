/**
 * The page fixture every browser test uses.
 *
 * - Any uncaught error, console error, failed request or error response (400 and up) on a
 *   page fails the test that loaded it, so a page that renders but logs an error still
 *   fails. Next may cancel a prefetch, or a successful RSC request superseded by the
 *   destination that has loaded. Both cases are classified narrowly; API failures stay fatal.
 * - Fonts are bundled by next/font and served by the app, so no font request is mocked.
 */
import { test as base, expect, type Request as BrowserRequest } from '@playwright/test'
import { isCompletedRouterCancellation } from './request-failures'
import { withCleanup, type Cleanup } from './api'

export const test = base.extend<{ problems: string[]; cleanup: Cleanup }>({
  cleanup: async ({ request }, use) => withCleanup(request, use),
  problems: [
    async ({ page }, use) => {
      const problems: string[] = []
      const failed: BrowserRequest[] = []
      page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console error: ${message.text()}`)
      })
      page.on('requestfailed', (request) => failed.push(request))
      page.on('response', (response) => {
        if (response.status() >= 400) {
          problems.push(
            `error response: ${response.status()} ${response.request().method()} ${response.url()}`,
          )
        }
      })
      await use(problems)
      for (const request of failed) {
        const reason = request.failure()?.errorText
        const headers = request.headers()
        if (reason === 'net::ERR_ABORTED' && headers['next-router-prefetch']) continue
        const response = await request.response()
        if (
          isCompletedRouterCancellation({
            reason,
            method: request.method(),
            headers,
            url: request.url(),
            destination: page.url(),
            status: response?.status(),
            contentType: response?.headers()['content-type'],
          })
        )
          continue
        problems.push(`request failed: ${request.method()} ${request.url()} (${reason})`)
      }
      expect(problems, 'errors on the page').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
