/**
 * The page fixture every browser test uses.
 *
 * - Any uncaught error, console error, failed request or error response (400 and up) on a
 *   page fails the test that loaded it, so a page that renders but logs an error still
 *   fails. Next may cancel a prefetch, or a successful RSC request superseded by the
 *   destination that has loaded. Both cases are classified narrowly; API failures stay fatal.
 * - A test that causes a refusal on purpose (an unknown id's 404) lists it in `refusals`
 *   first: that exact status, method and path must then happen exactly once, and only it
 *   and Chrome's console line for it are excused.
 * - Fonts are bundled by next/font and served by the app, so no font request is mocked.
 */
import { test as base, expect, type Request as BrowserRequest } from '@playwright/test'
import {
  isCompletedRouterCancellation,
  isExpectedRefusalLog,
  refusalIndex,
  type Refusal,
} from './request-failures'
import { withCleanup, type Cleanup } from './api'

export const test = base.extend<{ problems: string[]; cleanup: Cleanup; refusals: Refusal[] }>({
  cleanup: async ({ request }, use) => withCleanup(request, use),
  refusals: async ({}, provide) => provide([]),
  problems: [
    async ({ page, refusals }, use) => {
      const problems: string[] = []
      const failed: BrowserRequest[] = []
      const consoleErrors: { text: string; url: string }[] = []
      const refused: { status: number; method: string; url: string }[] = []
      page.on('pageerror', (error) => problems.push(`page error: ${error.message}`))
      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push({ text: message.text(), url: message.location().url })
        }
      })
      page.on('requestfailed', (request) => failed.push(request))
      page.on('response', (response) => {
        if (response.status() >= 400) {
          refused.push({
            status: response.status(),
            method: response.request().method(),
            url: response.url(),
          })
        }
      })
      await use(problems)
      // Sorted only now: a test lists its refusals after the page fixture has started.
      const seen = refusals.map(() => 0)
      for (const response of refused) {
        const index = refusalIndex(refusals, response)
        if (index >= 0) seen[index]++
        else problems.push(`error response: ${response.status} ${response.method} ${response.url}`)
      }
      for (const message of consoleErrors) {
        if (!isExpectedRefusalLog(refusals, message))
          problems.push(`console error: ${message.text}`)
      }
      refusals.forEach((r, i) => {
        if (seen[i] !== 1) {
          problems.push(`expected refusal ${r.status} ${r.method} ${r.path} came ${seen[i]} times`)
        }
      })
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
