#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

// Applies every pending migration in prisma/migrations to DATABASE_URL.
if (!process.env.DATABASE_URL) {
  console.error('migrate: DATABASE_URL is not set. Nothing was changed.')
  process.exit(1)
}

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
