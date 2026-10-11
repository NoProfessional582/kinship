/**
 * The map's render benchmark (map-render.spec.ts), apart from the tests: `npm run
 * test:e2e` never runs this config. Run it in the `browser` service of a test stack;
 * docs/graph-layout.md, "Measured in the browser", says how, and records the results.
 */
import { defineConfig, devices } from '@playwright/test'
import { BASE_URL } from '../support/stack'

export default defineConfig({
  testDir: '.',
  testMatch: 'map-render.spec.ts',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 180_000,
  outputDir: '../../test-results/benchmark',
  use: { baseURL: BASE_URL, timezoneId: 'UTC' },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
})
