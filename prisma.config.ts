import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

// Prisma 7 no longer auto-loads .env; dotenv/config above does it explicitly.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
    // `migrate dev --create-only` (npm run db:migrate:create) needs a separate
    // disposable database; set SHADOW_DATABASE_URL only for that. App builds and
    // deploys leave it unset.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
})
