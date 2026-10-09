import { defineConfig } from 'vitest/config'
import path from 'node:path'

/** DB-backed suite. Requires a reachable DATABASE_URL. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.integration.test.ts'],
    // Shares one database, so the specs must not race each other.
    fileParallelism: false,
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
