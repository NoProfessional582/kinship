import { prisma, type Tx } from './db'

/**
 * Serialize graph/recency mutations for one owner. Acquire before any reads in
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
 * while cooperating writers stay excluded until the snapshot is read.
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
