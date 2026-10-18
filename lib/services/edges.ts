import { prisma, type Tx } from '../db'
import { NotFoundError, ValidationError } from '../errors'
import { ownerTransaction } from '../owner-lock'
import { FOLLOWS_UP } from '../relations'

export { FOLLOWS_UP }

export type EntityType = 'contact' | 'project' | 'task' | 'entry'

export interface EdgeInput {
  sourceType: EntityType
  sourceId: string
  targetType: EntityType
  targetId: string
  relation: string
  note?: string | null
  weight?: number
}

/**
 * Generalised relationships: any entity to any entity. Replaces the old
 * contact-only table, so "Maya introduced me to Northwind" and "Maya reports to
 * Tobias" are the same kind of record.
 */
interface OwnedLookup {
  findFirst(args: {
    where: { id: string; owner: string }
    select: { id: true }
  }): Promise<{ id: string } | null>
}

async function requireOwnedEntity(db: Tx, owner: string, type: EntityType, id: string) {
  const delegate: OwnedLookup = db[type]
  const row = await delegate.findFirst({ where: { id, owner }, select: { id: true } })
  if (!row) throw new NotFoundError()
}

/**
 * Under the owner lock, like every other edge writer: the find-then-create is
 * otherwise a race on EntityEdge's unique key, and the loser of two identical
 * links at once got a 500 instead of the edge the winner made.
 */
export async function upsertEdge(owner: string, input: EdgeInput) {
  if (input.sourceType === input.targetType && input.sourceId === input.targetId) {
    throw new ValidationError('An entity cannot relate to itself')
  }
  return ownerTransaction(owner, async (tx) => {
    await requireOwnedEntity(tx, owner, input.sourceType, input.sourceId)
    await requireOwnedEntity(tx, owner, input.targetType, input.targetId)
    const where = {
      owner,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      targetType: input.targetType,
      targetId: input.targetId,
      relation: input.relation,
    }
    const existing = await tx.entityEdge.findFirst({ where, select: { id: true } })
    return existing
      ? tx.entityEdge.update({
          where: { id: existing.id },
          data: { note: input.note ?? null, weight: input.weight ?? 1 },
        })
      : tx.entityEdge.create({
          data: { ...input, owner, note: input.note ?? null, weight: input.weight ?? 1 },
        })
  })
}

export async function deleteEdge(owner: string, id: string) {
  await prisma.entityEdge.findFirstOrThrow({ where: { id, owner }, select: { id: true } })
  return prisma.entityEdge.delete({ where: { id } })
}

/** Every edge touching an entity, in either direction, with the far side resolved. */
export async function edgesFor(owner: string, type: EntityType, id: string) {
  await requireOwnedEntity(prisma, owner, type, id)
  const rows = await prisma.entityEdge.findMany({
    where: {
      owner,
      OR: [
        { sourceType: type, sourceId: id },
        { targetType: type, targetId: id },
      ],
    },
    orderBy: { createdAt: 'asc' },
  })

  const wanted = {
    contact: new Set<string>(),
    project: new Set<string>(),
    task: new Set<string>(),
    entry: new Set<string>(),
  }
  for (const e of rows) {
    const outgoing = e.sourceType === type && e.sourceId === id
    const t = (outgoing ? e.targetType : e.sourceType) as EntityType
    const i = outgoing ? e.targetId : e.sourceId
    wanted[t]?.add(i)
  }

  const [contacts, projects, tasks, entries] = await Promise.all([
    prisma.contact.findMany({
      where: { owner, id: { in: [...wanted.contact] } },
      select: { id: true, slug: true, displayName: true },
    }),
    prisma.project.findMany({
      where: { owner, id: { in: [...wanted.project] } },
      select: { id: true, slug: true, name: true, color: true },
    }),
    prisma.task.findMany({
      where: { owner, id: { in: [...wanted.task] } },
      select: { id: true, slug: true, title: true },
    }),
    prisma.entry.findMany({
      where: { owner, id: { in: [...wanted.entry] } },
      select: { id: true, title: true, kind: true },
    }),
  ])

  const label = (t: EntityType, i: string) =>
    t === 'contact'
      ? contacts.find((x) => x.id === i)?.displayName
      : t === 'project'
        ? projects.find((x) => x.id === i)?.name
        : t === 'task'
          ? tasks.find((x) => x.id === i)?.title
          : entries.find((x) => x.id === i)?.title || 'Untitled'

  const href = (t: EntityType, i: string) =>
    t === 'contact'
      ? `/contacts/${contacts.find((x) => x.id === i)?.slug ?? i}`
      : t === 'project'
        ? `/projects/${projects.find((x) => x.id === i)?.slug ?? i}`
        : t === 'task'
          ? `/board?task=${i}`
          : `/notes/${i}`

  return rows.map((e) => {
    const outgoing = e.sourceType === type && e.sourceId === id
    const otherType = (outgoing ? e.targetType : e.sourceType) as EntityType
    const otherId = outgoing ? e.targetId : e.sourceId
    return {
      id: e.id,
      relation: e.relation,
      note: e.note,
      direction: outgoing ? ('out' as const) : ('in' as const),
      otherType,
      otherId,
      label: label(otherType, otherId) ?? 'Unknown',
      href: href(otherType, otherId),
    }
  })
}

/**
 * Every follow-up edge touching a set of entries, in both directions.
 * `EntityEdge` deliberately carries no Prisma relation back to `Entry` — it is
 * type-agnostic — so this one query stands in for an `include`.
 */
export async function followUpEdges(owner: string, entryIds: string[]) {
  const ids = [...new Set(entryIds)].filter(Boolean)
  if (ids.length === 0) return []
  return prisma.entityEdge.findMany({
    where: {
      owner,
      relation: FOLLOWS_UP,
      sourceType: 'entry',
      targetType: 'entry',
      OR: [{ sourceId: { in: ids } }, { targetId: { in: ids } }],
    },
    select: { sourceId: true, targetId: true },
  })
}
