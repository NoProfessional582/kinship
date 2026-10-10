import { prisma } from '../db'
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

async function requireOwnedEntity(owner: string, type: EntityType, id: string) {
  const delegate: OwnedLookup = prisma[type]
  const row = await delegate.findFirst({ where: { id, owner }, select: { id: true } })
  if (!row) throw Object.assign(new Error('Not found'), { code: 'P2025' })
}

export async function upsertEdge(owner: string, input: EdgeInput) {
  await Promise.all([
    requireOwnedEntity(owner, input.sourceType, input.sourceId),
    requireOwnedEntity(owner, input.targetType, input.targetId),
  ])
  const where = {
    owner,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    targetType: input.targetType,
    targetId: input.targetId,
    relation: input.relation,
  }
  const existing = await prisma.entityEdge.findFirst({ where, select: { id: true } })
  return existing
    ? prisma.entityEdge.update({
        where: { id: existing.id },
        data: { note: input.note ?? null, weight: input.weight ?? 1 },
      })
    : prisma.entityEdge.create({
        data: { ...input, owner, note: input.note ?? null, weight: input.weight ?? 1 },
      })
}

export async function deleteEdge(owner: string, id: string) {
  await prisma.entityEdge.findFirstOrThrow({ where: { id, owner }, select: { id: true } })
  return prisma.entityEdge.delete({ where: { id } })
}

/** Every edge touching an entity, in either direction, with the far side resolved. */
export async function edgesFor(owner: string, type: EntityType, id: string) {
  await requireOwnedEntity(owner, type, id)
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
      select: { id: true, slug: true, displayName: true, avatarUrl: true },
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
      avatarUrl:
        otherType === 'contact'
          ? (contacts.find((x) => x.id === otherId)?.avatarUrl ?? null)
          : null,
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
