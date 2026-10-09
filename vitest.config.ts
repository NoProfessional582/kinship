import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * Default run is the fast, dependency-free unit suite. The DB-backed
 * integration suite is excluded here and run explicitly inside the compose
 * network, where DATABASE_URL resolves — see `npm run test:integration`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/**/*.integration.test.ts'],
    // Only the jsdom specs need it, but loading it globally is harmless.
    setupFiles: ['tests/jsdom-setup.ts'],
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
