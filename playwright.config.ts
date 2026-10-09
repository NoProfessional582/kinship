/**
 * Playwright runs inside the test stack (scripts/test-stack.sh), in the `browser` service of
 * tests/compose.test.yaml, against the app at BASE_URL (http://web:3000 on the stack's
 * network). It starts no server.
 *
 *   api      tests/integration  every API route, /uploads and /icons, over HTTP
 *   desktop  tests/e2e          tests tagged @desktop, in Desktop Chrome: the desktop pages
 *   phone    tests/e2e          tests tagged @phone, on a Pixel 7: the pages under /m, and /
 *   archive  tests/archive      importing archives, which replaces the owner's data, so it
 *                               runs last, once the three above have passed
 *
 * One worker: there is one owner and one shared database.
 */
import { defineConfig, devices } from '@playwright/test'
import { BASE_URL } from './tests/support/stack'

export default defineConfig({
  testMatch: '**/*.spec.ts',
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
    { name: 'api', testDir: 'tests/integration' },
    {
      name: 'desktop',
      testDir: 'tests/e2e',
      grep: /@desktop/,
      use: { ...devices['Desktop Chrome'] },
    },
    { name: 'phone', testDir: 'tests/e2e', grep: /@phone/, use: { ...devices['Pixel 7'] } },
    {
      name: 'archive',
      testDir: 'tests/archive',
      dependencies: ['api', 'desktop', 'phone'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
