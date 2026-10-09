import { PrismaClient, type Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

/**
 * Prisma 7 connects through a driver adapter rather than a datasource url in
 * the schema, so the connection string is read here at construction time.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createClient() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

/** A transaction handle, as `prisma.$transaction(async (tx) => ...)` passes it. */
export type Tx = Prisma.TransactionClient

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
