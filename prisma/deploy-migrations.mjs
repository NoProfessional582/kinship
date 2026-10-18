#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

// Applies every pending migration in prisma/migrations to DATABASE_URL.
if (!process.env.DATABASE_URL) {
  console.error('migrate: DATABASE_URL is not set. Nothing was changed.')
  process.exit(1)
}

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  // On Windows npx is npx.cmd, which Node only runs through a shell. The arguments are fixed.
  shell: process.platform === 'win32',
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
