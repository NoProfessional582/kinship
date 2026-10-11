import { Client } from 'pg'
import { prisma, type Tx } from './db'

/**
 * Serialize graph/recency/photo mutations for one owner. Acquire before any reads in
 * a READ COMMITTED transaction so a waiter sees the previous writer's commit.
 * Hash collisions only serialize unrelated owners; they cannot grant access.
 */
export async function lockOwnerGraph(tx: Tx, owner: string): Promise<void> {
  await tx.$queryRaw`SELECT set_config('lock_timeout', '10s', true)`
  await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(1936289384, hashtext(${owner}))`
}

/** A bounded, explicitly READ COMMITTED transaction for cooperating writers. */
export function ownerTransaction<T>(owner: string, work: (tx: Tx) => Promise<T>) {
  return prisma.$transaction(
    async (tx) => {
      await lockOwnerGraph(tx, owner)
      return work(tx)
    },
    { isolationLevel: 'ReadCommitted', timeout: 20000, maxWait: 10000 },
  )
}

/**
 * Acquire the lifecycle lock BEFORE opening the repeatable-read snapshot. Waiting
 * inside that snapshot would capture data before the previous writer committed.
 * Two bounded connections keep non-cooperating table writers snapshot-consistent
 * while cooperating reference/file writers remain excluded until bytes are read.
 * Never acquire the owner lock from inside the snapshot callback.
 */
export function ownerSnapshot<T>(owner: string, work: (tx: Tx) => Promise<T>) {
  return prisma.$transaction(
    async (guard) => {
      await lockOwnerGraph(guard, owner)
      return prisma.$transaction(work, {
        isolationLevel: 'RepeatableRead',
        timeout: 120000,
        maxWait: 10000,
      })
    },
    { isolationLevel: 'ReadCommitted', timeout: 140000, maxWait: 10000 },
  )
}

/** Collection must retain its lock until filesystem calls finish, even if they
 * take longer than Prisma's interactive-transaction deadline. Use a dedicated
 * session with a bounded connect/lock wait but no callback rollback timer. The
 * same advisory key excludes every existing owner transaction across processes.
 * Only read database references here; this is not a replacement write client. */
export async function ownerCollection<T>(
  owner: string,
  work: (checkLock: () => Promise<void>) => Promise<T>,
) {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
  })
  let failure: Error | undefined
  client.on('error', (err) => {
    failure = err
  })
  try {
    await client.connect()
    await client.query("SET lock_timeout = '10s'")
    await client.query('SELECT pg_advisory_lock(1936289384, hashtext($1))', [owner])
    return await work(async () => {
      if (failure) throw failure
      await client.query('SELECT 1')
    })
  } finally {
    // Closing the dedicated connection releases the session lock only after all
    // awaited filesystem work ended; it cannot leak into a pooled connection.
    await client.end()
  }
}
