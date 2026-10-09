import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError } from '@/lib/errors'
import { STEP } from '@/lib/fractional-index'

/**
 * Trash, purge and empty-trash against a real database (K01-K04).
 *
 * `@/lib/db` is replaced for this file so two things can be exercised that the
 * ordinary singleton cannot:
 *
 *  1. **A failure injected after the entity delete.** A Prisma client extension
 *     makes `entityEdge.deleteMany` throw on demand. That is the only statement
 *     in `purge` that runs *after* the row is deleted, so it is exactly the
 *     window K01 describes: the old code deleted the entity through the GLOBAL
 *     client while only the edge cleanup was transactional, so a failure here
 *     rolled back nothing and the entity was already gone.
 *
 *  2. **A single-connection pool.** K01's other half: with one connection
 *     available, a delete issued on the global client while a transaction holds
 *     that connection blocks. Everything now runs on the transaction handle, so
 *     one connection is enough — and if it ever regresses, these tests hang or
 *     fail rather than passing quietly.
 */
vi.mock('@/lib/db', async () => {
  const { PrismaClient } = await import('@prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const base = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 }),
  })
  const prisma = base.$extends({
    query: {
      entityEdge: {
        async deleteMany({ args, query }: any) {
          if ((globalThis as any).__failEdgeDeletes) {
            throw new Error('injected edge-delete failure')
          }
          return query(args)
        },
      },
    },
  })
  return { prisma }
})

const { prisma } = await import('@/lib/db')
const trash = await import('@/lib/services/trash')

const MARK = `__trashtest_${Date.now()}__`
const OWNER = `${MARK}owner`
const deleteEdgesFor = (kind: any, ids: string[]) => trash.deleteEdgesFor(OWNER, kind, ids)
const emptyTrash = () => trash.emptyTrash(OWNER)
const purge = (kind: any, id: string, expected?: Date | string | null) =>
  trash.purge(OWNER, kind, id, expected)
const softDelete = (kind: any, id: string) => trash.softDelete(OWNER, kind, id)
const restore = (kind: any, id: string) => trash.restore(OWNER, kind, id)
const failEdges = (on: boolean) => {
  ;(globalThis as any).__failEdgeDeletes = on
}

let columnId: string

async function column() {
  if (!columnId) {
    const c = await prisma.boardColumn.create({
      data: { owner: OWNER, name: `${MARK}col`, status: 'TODO', position: STEP, projectId: null },
    })
    columnId = c.id
  }
  return columnId
}

async function makeTask(title: string, extra: Record<string, unknown> = {}) {
  return prisma.task.create({
    data: {
      owner: OWNER,
      slug: `${MARK}${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title: `${MARK}${title}`,
      columnId: await column(),
      position: STEP,
      ...extra,
    },
  })
}

async function makeContact(name: string) {
  return prisma.contact.create({
    data: {
      owner: OWNER,
      slug: `${MARK}${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      displayName: `${MARK}${name}`,
    },
  })
}

/** An edge in both directions' reach: this entity as source, and as target. */
async function makeEdges(kind: string, id: string) {
  await prisma.entityEdge.create({
    data: {
      owner: OWNER,
      sourceType: kind,
      sourceId: id,
      targetType: 'contact',
      targetId: `${MARK}far`,
      relation: `${MARK}out`,
    },
  })
  await prisma.entityEdge.create({
    data: {
      owner: OWNER,
      sourceType: 'contact',
      sourceId: `${MARK}far`,
      targetType: kind,
      targetId: id,
      relation: `${MARK}in`,
    },
  })
}

const edgeCount = (kind: string, id: string) =>
  prisma.entityEdge.count({
    where: {
      owner: OWNER,
      OR: [
        { sourceType: kind, sourceId: id },
        { targetType: kind, targetId: id },
      ],
    },
  })

beforeEach(() => failEdges(false))

afterAll(async () => {
  failEdges(false)
  await prisma.entityEdge.deleteMany({ where: { relation: { startsWith: MARK } } })
  await prisma.task.deleteMany({ where: { title: { startsWith: MARK } } })
  await prisma.contact.deleteMany({ where: { displayName: { startsWith: MARK } } })
  await prisma.boardColumn.deleteMany({ where: { name: { startsWith: MARK } } })
  await prisma.$disconnect()
})

describe('purge — atomicity (K01)', () => {
  it('leaves the entity AND its edges intact when edge cleanup fails', async () => {
    const c = await makeContact('atomic')
    await makeEdges('contact', c.id)
    await softDelete('contact', c.id)
    expect(await edgeCount('contact', c.id)).toBe(2)

    failEdges(true)
    await expect(purge('contact', c.id)).rejects.toThrow('injected edge-delete failure')
    failEdges(false)

    // Before the fix the row was already gone here: the delete had committed
    // outside the transaction that then rolled back.
    expect(await prisma.contact.findUnique({ where: { id: c.id } })).not.toBeNull()
    expect(await edgeCount('contact', c.id)).toBe(2)
  })

  it('removes the entity and every edge together on success', async () => {
    const c = await makeContact('happy')
    await makeEdges('contact', c.id)
    await softDelete('contact', c.id)

    await purge('contact', c.id)

    expect(await prisma.contact.findUnique({ where: { id: c.id } })).toBeNull()
    expect(await edgeCount('contact', c.id)).toBe(0)
  })
})

describe('purge — only trashed rows, and only current views (K02)', () => {
  it('refuses a live row, so a direct request cannot skip the trash', async () => {
    const c = await makeContact('live')
    await expect(purge('contact', c.id)).rejects.toBeInstanceOf(ConflictError)
    expect(await prisma.contact.findUnique({ where: { id: c.id } })).not.toBeNull()
  })

  it('refuses a row restored since the trash view loaded', async () => {
    const c = await makeContact('restored')
    await softDelete('contact', c.id)
    const stale = (await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).deletedAt

    await restore('contact', c.id) // another tab

    await expect(purge('contact', c.id, stale)).rejects.toBeInstanceOf(ConflictError)
    expect(await prisma.contact.findUnique({ where: { id: c.id } })).not.toBeNull()
  })

  it('refuses when the row was trashed again under a stale timestamp', async () => {
    const c = await makeContact('retrashed')
    await softDelete('contact', c.id)
    const stale = (await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).deletedAt

    await restore('contact', c.id)
    await new Promise((r) => setTimeout(r, 5))
    await softDelete('contact', c.id) // a different deletion, same row

    await expect(purge('contact', c.id, stale)).rejects.toBeInstanceOf(ConflictError)
    expect(await prisma.contact.findUnique({ where: { id: c.id } })).not.toBeNull()
  })

  it('accepts a purge whose timestamp still matches', async () => {
    const c = await makeContact('current')
    await softDelete('contact', c.id)
    const current = (await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).deletedAt

    await purge('contact', c.id, current)
    expect(await prisma.contact.findUnique({ where: { id: c.id } })).toBeNull()
  })
})

describe('purge — subtree policy (K03)', () => {
  it('refuses a trashed parent that still has a live subtask, and destroys nothing', async () => {
    const parent = await makeTask('parent-live')
    const child = await makeTask('child-live', { parentTaskId: parent.id })
    await makeEdges('task', parent.id)
    await makeEdges('task', child.id)
    await softDelete('task', parent.id)

    await expect(purge('task', parent.id)).rejects.toBeInstanceOf(ConflictError)

    // Task.parent is onDelete: Cascade, so this is the case that used to delete
    // a task nobody put in the trash.
    expect(await prisma.task.findUnique({ where: { id: child.id } })).not.toBeNull()
    expect(await prisma.task.findUnique({ where: { id: parent.id } })).not.toBeNull()
    expect(await edgeCount('task', parent.id)).toBe(2)
    expect(await edgeCount('task', child.id)).toBe(2)
  })

  it('purges a fully trashed subtree and leaves no orphan edges at any depth', async () => {
    const parent = await makeTask('p-all')
    const child = await makeTask('c-all', { parentTaskId: parent.id })
    const grand = await makeTask('g-all', { parentTaskId: child.id })
    for (const t of [parent, child, grand]) {
      await makeEdges('task', t.id)
      await softDelete('task', t.id)
    }

    await purge('task', parent.id)

    for (const t of [parent, child, grand]) {
      expect(await prisma.task.findUnique({ where: { id: t.id } })).toBeNull()
      // The old code cleaned edges for the requested id only, so the cascaded
      // descendants' edges were orphaned permanently.
      expect(await edgeCount('task', t.id)).toBe(0)
    }
  })

  it('refuses when the live descendant is below a trashed one', async () => {
    const parent = await makeTask('p-deep')
    const child = await makeTask('c-deep', { parentTaskId: parent.id })
    const grand = await makeTask('g-deep-live', { parentTaskId: child.id })
    await softDelete('task', parent.id)
    await softDelete('task', child.id)

    await expect(purge('task', parent.id)).rejects.toBeInstanceOf(ConflictError)
    expect(await prisma.task.findUnique({ where: { id: grand.id } })).not.toBeNull()
    expect(await prisma.task.findUnique({ where: { id: parent.id } })).not.toBeNull()
  })
})

describe('emptyTrash — all or nothing (K04)', () => {
  beforeAll(async () => {
    // The specs above deliberately leave trashed parents holding LIVE children:
    // that is the state the policy refuses, and emptyTrash applies the policy to
    // the whole database. They are this file's fixtures, not the case under test
    // here, so clear them before exercising a global sweep. (That the sweep
    // refused because of them is itself the policy working — see K03.)
    const tasks = await prisma.task.findMany({
      where: { title: { startsWith: MARK } },
      select: { id: true },
    })
    await prisma.task.deleteMany({ where: { title: { startsWith: MARK } } })
    await deleteEdgesFor(
      'task',
      tasks.map((t) => t.id),
    )
  })

  it('rolls the whole sweep back when edge cleanup fails', async () => {
    const c = await makeContact('empty-atomic')
    await makeEdges('contact', c.id)
    await softDelete('contact', c.id)
    const before = await prisma.contact.count({ where: { deletedAt: { not: null } } })
    expect(before).toBeGreaterThan(0)

    failEdges(true)
    await expect(emptyTrash()).rejects.toThrow('injected edge-delete failure')
    failEdges(false)

    expect(await prisma.contact.findUnique({ where: { id: c.id } })).not.toBeNull()
    expect(await edgeCount('contact', c.id)).toBe(2)
    expect(await prisma.contact.count({ where: { deletedAt: { not: null } } })).toBe(before)
  })

  it('refuses while a trashed parent still has a live subtask', async () => {
    const parent = await makeTask('empty-parent')
    const child = await makeTask('empty-child-live', { parentTaskId: parent.id })
    await softDelete('task', parent.id)

    await expect(emptyTrash()).rejects.toBeInstanceOf(ConflictError)
    expect(await prisma.task.findUnique({ where: { id: child.id } })).not.toBeNull()
    expect(await prisma.task.findUnique({ where: { id: parent.id } })).not.toBeNull()

    // Clear the blocker so the suite's remaining state is usable.
    await softDelete('task', child.id)
  })

  it('empties the trash and cleans every edge in one transaction', async () => {
    const c = await makeContact('empty-ok')
    const t = await makeTask('empty-ok-task')
    await makeEdges('contact', c.id)
    await makeEdges('task', t.id)
    await softDelete('contact', c.id)
    await softDelete('task', t.id)

    await emptyTrash()

    expect(await prisma.contact.findUnique({ where: { id: c.id } })).toBeNull()
    expect(await prisma.task.findUnique({ where: { id: t.id } })).toBeNull()
    expect(await edgeCount('contact', c.id)).toBe(0)
    expect(await edgeCount('task', t.id)).toBe(0)
    // Owner-scoped: another subject's trash is not this caller's to empty.
    expect(await prisma.contact.count({ where: { owner: OWNER, deletedAt: { not: null } } })).toBe(
      0,
    )
  })
})
