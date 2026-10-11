import type { Prisma } from '@prisma/client'
import { prisma } from '../db'
import { ConflictError } from '../errors'
import { ownerTransaction } from '../owner-lock'
import { photoTransaction } from '../photo-lifecycle'
import { contactsMentionedBy, recomputeLastContact } from './recency'

export type TrashKind = 'contact' | 'entry' | 'task' | 'project'

const KINDS = ['contact', 'entry', 'task', 'project'] as const

/**
 * Either the global client or a transaction handle.
 *
 * This type is the whole point of the K01 fix. `purge` used to open
 * `prisma.$transaction(tx => ...)` and then delete the entity through a
 * delegate resolved from the GLOBAL client, so only the edge cleanup was
 * transactional: if that cleanup failed, the rollback rolled back nothing that
 * mattered and the entity was already gone. With a single free connection the
 * global call could also block on the connection the transaction was holding.
 * Every statement below therefore goes through the client it is handed.
 */
type Db = typeof prisma | Prisma.TransactionClient

type OwnedId = { id: string; owner: string }
type Trashed = { owner: string; deletedAt: { not: null } }

/** The part of each trashable model's delegate this module uses. */
interface TrashDelegate {
  findFirstOrThrow(args: { where: OwnedId; select: { id: true } }): Promise<{ id: string }>
  findFirst(args: {
    where: OwnedId
    select: { id: true; deletedAt: true }
  }): Promise<{ id: string; deletedAt: Date | null } | null>
  findMany(args: { where: Trashed; select: { id: true } }): Promise<{ id: string }[]>
  update(args: {
    where: { id: string }
    data: { deletedAt: Date | null }
  }): Promise<{ id: string; deletedAt: Date | null }>
  delete(args: { where: { id: string } }): Promise<{ id: string; deletedAt: Date | null }>
  deleteMany(args: { where: { id: { in: string[] } } }): Promise<{ count: number }>
}

/** Model delegate for a kind, bound to a specific client. */
const model = (db: Db, kind: TrashKind): TrashDelegate => db[kind]

/**
 * Soft delete. Rows are marked rather than removed so a misclick on years of
 * personal history is recoverable; every list query filters `deletedAt: null`.
 */
export async function softDelete(owner: string, kind: TrashKind, id: string) {
  return ownerTransaction(owner, async (tx) => {
    await model(tx, kind).findFirstOrThrow({ where: { id, owner }, select: { id: true } })
    const row = await model(tx, kind).update({ where: { id }, data: { deletedAt: new Date() } })
    if (kind === 'entry')
      await recomputeLastContact(tx, owner, await contactsMentionedBy(tx, owner, id))
    return row
  })
}

export async function restore(owner: string, kind: TrashKind, id: string) {
  return ownerTransaction(owner, async (tx) => {
    await model(tx, kind).findFirstOrThrow({ where: { id, owner }, select: { id: true } })
    const row = await model(tx, kind).update({ where: { id }, data: { deletedAt: null } })
    if (kind === 'entry')
      await recomputeLastContact(tx, owner, await contactsMentionedBy(tx, owner, id))
    return row
  })
}

/**
 * Edges are a free-standing table: `sourceType`/`sourceId` are plain columns,
 * not relations, so there is no foreign key for Postgres to cascade and
 * deleting a row leaves every edge that referenced it behind forever.
 *
 * Nothing surfaces those orphans — `edgesFor` only looks up edges for an entity
 * you are viewing, and a purged entity has no view — so they are invisible dead
 * weight rather than a visible bug, right up until a half-orphaned edge renders
 * as an "Unknown" link on whatever survived at the other end.
 *
 * `db` defaults to the global client so existing callers (and the test suite)
 * keep working, but everything inside a purge passes its transaction.
 */
export async function deleteEdgesFor(
  owner: string,
  kind: TrashKind,
  ids: string[],
  db: Db = prisma,
) {
  if (!ids.length) return
  await db.entityEdge.deleteMany({
    where: {
      owner,
      OR: [
        { sourceType: kind, sourceId: { in: ids } },
        { targetType: kind, targetId: { in: ids } },
      ],
    },
  })
}

/**
 * ── Subtree policy (K03) ─────────────────────────────────────────────────────
 *
 * `Task.parent` is `onDelete: Cascade` (prisma/schema.prisma), so deleting a
 * trashed parent task makes Postgres delete every descendant — INCLUDING ones
 * that were never trashed. Nothing asked for that, nothing warned about it, and
 * because edge cleanup only ever targeted the requested id, those descendants
 * also left their polymorphic edges behind.
 *
 * The policy, chosen here and applied identically by `purge` and `emptyTrash`:
 *
 *   **A purge REFUSES while any descendant is still live.** Trashed descendants
 *   are purged with the parent, because they are already in the trash and the
 *   user has already said so. A live descendant is not in the trash and must
 *   never be destroyed by an action aimed at something else.
 *
 * The rejected alternative was to soft-delete or silently absorb the subtree.
 * That turns "permanently delete this one thing" into a mutation of rows the
 * user never selected, which is precisely the surprise this app's trash exists
 * to prevent. Refusing is recoverable and the message says what to do; the
 * other way round is not.
 *
 * Returns every id in the subtree, so their edges can be cleaned in the same
 * transaction that deletes them.
 */
async function trashedSubtreeIds(db: Db, owner: string, rootId: string): Promise<string[]> {
  const collected = [rootId]
  const seen = new Set(collected)
  let frontier = [rootId]

  while (frontier.length) {
    const children = await db.task.findMany({
      where: { owner, parentTaskId: { in: frontier } },
      select: { id: true, title: true, deletedAt: true },
    })
    if (!children.length) break

    const live = children.filter((c) => c.deletedAt === null)
    if (live.length) {
      const names = live.map((c) => `"${c.title}"`).join(', ')
      throw new ConflictError(
        `This task still has ${live.length} subtask${live.length > 1 ? 's' : ''} that ${
          live.length > 1 ? 'are' : 'is'
        } not in the trash (${names}). Deleting it permanently would delete ${
          live.length > 1 ? 'them' : 'it'
        } too. Move ${live.length > 1 ? 'them' : 'it'} to the trash first, or reparent ${
          live.length > 1 ? 'them' : 'it'
        }.`,
      )
    }

    // A malformed parent cycle would otherwise loop forever.
    frontier = children.map((c) => c.id).filter((id) => !seen.has(id))
    for (const id of frontier) {
      seen.add(id)
      collected.push(id)
    }
  }

  return collected
}

/**
 * Irreversible. Only reachable from the trash view.
 *
 * `expectedDeletedAt` is the `deletedAt` the caller was looking at when it
 * decided to purge. It is how a stale trash tab is caught (K02): if the row was
 * restored and re-trashed in another tab, the timestamp moved, and this purge
 * is acting on information that is no longer true.
 */
export async function purge(
  owner: string,
  kind: TrashKind,
  id: string,
  expectedDeletedAt?: Date | string | null,
) {
  return photoTransaction(owner, async (tx) => {
    // Read the row INSIDE the transaction. The old code deleted by id alone, so
    // a purge could destroy a row that had been restored elsewhere, and a
    // request made directly against the API could skip the soft-delete stage
    // altogether (K02).
    const row = await model(tx, kind).findFirst({
      where: { id, owner },
      select: { id: true, deletedAt: true },
    })

    if (!row) {
      throw new ConflictError('That item no longer exists. Reload the trash.')
    }
    if (!row.deletedAt) {
      throw new ConflictError(
        'That item is not in the trash — it may have been restored in another tab. ' +
          'Only trashed items can be deleted permanently.',
      )
    }
    if (
      expectedDeletedAt != null &&
      new Date(expectedDeletedAt).getTime() !== row.deletedAt.getTime()
    ) {
      throw new ConflictError(
        'That item was restored and trashed again since this view loaded. ' +
          'Reload the trash and try again.',
      )
    }

    // Tasks cascade to their subtasks; everything else is just itself.
    const ids = kind === 'task' ? await trashedSubtreeIds(tx, owner, id) : [id]

    const deleted = await model(tx, kind).delete({ where: { id } })
    await deleteEdgesFor(owner, kind, ids, tx)
    return deleted
  })
}

export async function emptyTrash(owner: string) {
  return photoTransaction(owner, async (tx) => {
    const deleted = { owner, deletedAt: { not: null } } as const

    // Capture the ids inside the transaction and delete by exactly those ids
    // (K04). The old version ran four unsynchronised `deleteMany`s against a
    // `deletedAt: not null` predicate and cleaned edges afterwards outside any
    // transaction, so a row trashed mid-run could be deleted but never
    // edge-cleaned, and a failure part-way through emptied part of the trash.
    const ids = {} as Record<TrashKind, string[]>
    for (const kind of KINDS) {
      const rows = await model(tx, kind).findMany({ where: deleted, select: { id: true } })
      ids[kind] = rows.map((r) => r.id)
    }

    // Same subtree policy as `purge`. One query is enough: every trashed task is
    // in `ids.task`, so any live child of any of them is a child of that set.
    if (ids.task.length) {
      const liveChildren = await tx.task.findMany({
        where: { owner, parentTaskId: { in: ids.task }, deletedAt: null },
        select: { title: true },
      })
      if (liveChildren.length) {
        const names = liveChildren.map((c) => `"${c.title}"`).join(', ')
        throw new ConflictError(
          `Emptying the trash would permanently delete ${liveChildren.length} subtask${
            liveChildren.length > 1 ? 's' : ''
          } that ${liveChildren.length > 1 ? 'are' : 'is'} not in the trash (${names}), ` +
            'because their parent task is. Move them to the trash first, or reparent them.',
        )
      }
    }

    const counts = {} as Record<TrashKind, number>
    for (const kind of KINDS) {
      // Deleting a parent task cascades to trashed children, so a later id in
      // this set may already be gone. deleteMany simply matches fewer rows.
      const res = await model(tx, kind).deleteMany({ where: { id: { in: ids[kind] } } })
      counts[kind] = res.count
    }

    for (const kind of KINDS) {
      await deleteEdgesFor(owner, kind, ids[kind], tx)
    }

    return {
      contacts: counts.contact,
      entries: counts.entry,
      tasks: counts.task,
      projects: counts.project,
    }
  })
}

export async function listTrash(owner: string) {
  const deleted = { owner, deletedAt: { not: null } } as const
  const order = { deletedAt: 'desc' as const }

  const [contacts, entries, tasks, projects] = await Promise.all([
    prisma.contact.findMany({
      where: deleted,
      orderBy: order,
      select: { id: true, displayName: true, avatarUrl: true, deletedAt: true },
    }),
    prisma.entry.findMany({
      where: deleted,
      orderBy: order,
      select: { id: true, title: true, kind: true, bodyText: true, deletedAt: true },
    }),
    prisma.task.findMany({
      where: deleted,
      orderBy: order,
      select: { id: true, title: true, deletedAt: true },
    }),
    prisma.project.findMany({
      where: deleted,
      orderBy: order,
      select: { id: true, name: true, color: true, deletedAt: true },
    }),
  ])

  return {
    contacts,
    entries,
    tasks,
    projects,
    total: contacts.length + entries.length + tasks.length + projects.length,
  }
}
