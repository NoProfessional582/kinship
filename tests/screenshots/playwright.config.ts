/**
 * The README's screenshots (scripts/screenshots.sh), apart from the tests: `npm run
 * test:e2e` never runs this config. It runs in the `browser` service of a throwaway stack
 * holding only the demo seed (prisma/seed.ts), and writes docs/screenshots/*.png.
 */
import { defineConfig, devices } from '@playwright/test'
import { BASE_URL } from '../support/stack'

export default defineConfig({
  testDir: '.',
  testMatch: 'screenshots.spec.ts',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  outputDir: '../../test-results/screenshots',
  use: { baseURL: BASE_URL, timezoneId: 'UTC', colorScheme: 'light' },
  projects: [
    {
      name: 'desktop',
      grep: /@desktop/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    { name: 'phone', grep: /@phone/, use: { ...devices['Pixel 7'] } },
  ],
})
