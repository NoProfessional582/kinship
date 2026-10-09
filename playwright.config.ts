/**
 * Playwright runs inside the test stack (scripts/test-stack.sh), in the `browser` service of
 * tests/compose.test.yaml, against the app at BASE_URL (http://web:3000 on the stack's
 * network). It starts no server.
 *
 *   desktop  Desktop Chrome   tests tagged @desktop: the desktop pages
 *   phone    Pixel 7          tests tagged @phone: the pages under /m, and / on a phone
 *
 * One worker: there is one owner and one shared database.
 */
import { defineConfig, devices } from '@playwright/test'
import { BASE_URL } from './tests/support/stack'

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', grep: /@desktop/, use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', grep: /@phone/, use: { ...devices['Pixel 7'] } },
  ],
})
