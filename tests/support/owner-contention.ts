import { prisma } from '@/lib/db'
import { lockOwnerGraph } from '@/lib/owner-lock'

/** Hold the real lock until all writers are observed waiting in PostgreSQL. */
export async function contend<T>(owner: string, writers: (() => Promise<T>)[]) {
  let signalHeld!: () => void
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    signalHeld = resolve
  })
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const blocker = prisma.$transaction(
    async (tx) => {
      await lockOwnerGraph(tx, owner)
      signalHeld()
      await released
    },
    { timeout: 15000 },
  )
  await held
  const results = Promise.allSettled(writers.map((write) => write()))
  try {
    const deadline = Date.now() + 3000
    while (true) {
      const [row] = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_locks
        WHERE locktype = 'advisory' AND classid = 1936289384
          AND objid::bigint = (hashtext(${owner})::bigint & 4294967295)
          AND NOT granted`
      if (row.n >= writers.length) break
      if (Date.now() >= deadline) throw new Error('Writers did not contend on the owner lock')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  } finally {
    release()
    await blocker
  }
  return results
}
