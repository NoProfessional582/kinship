import { prisma } from '../db'
import { uniqueSlug } from '../slug'
import {
  collectDocRefs,
  rewriteDocIds,
  docToText,
  type PendingEntity,
  type ProseNode,
} from '../tiptap/doc'
import type { CreateEntryInput } from '../validation'
import { appendPosition, defaultColumnId } from './board'
import { FOLLOWS_UP, followUpEdges } from './edges'
import { resolveTagIds } from './tags'
import { contactsMentionedBy, recomputeLastContact } from './recency'

export interface CreatedEntity {
  type: 'contact' | 'task' | 'project'
  id: string
  label: string
}

const EMPTY_DOC: ProseNode = { type: 'doc', content: [{ type: 'paragraph' }] }

/**
 * One end of a follow-up link, flattened for the client.
 *
 * `written` rather than the body itself: the card only needs to know whether
 * the conversation has been written up yet, and shipping every linked body
 * into a list view would double what the feed weighs.
 */
export interface FollowUpLink {
  id: string
  kind: string
  title: string | null
  occurredAt: Date
  written: boolean
}

const followUpTitle = (parent: { title: string | null; kind: string }) =>
  `Follow up — ${parent.title?.trim() || parent.kind.toLowerCase().replace('_', ' ')}`

/**
 * Creates the forward-dated entry that continues `parent`, plus the edge that
 * ties the two together.
 *
 * Kind, project and people are inherited: a promise made on a call with Maya is
 * most likely another call with Maya, and a follow-up that reached nobody's
 * dossier would be missing from exactly the page you would look for it on. All
 * three are editable on the follow-up note itself.
 *
 * The body is left empty deliberately. That emptiness is the system's only
 * answer to "did this happen?" — a past-dated entry nobody wrote into is an
 * open loop — so seeding it with placeholder prose would close every loop at
 * the moment it opened.
 */
async function createFollowUp(
  tx: any,
  owner: string,
  parent: { id: string; kind: string; title: string | null; projectId: string | null },
  at: Date,
  contactIds: string[],
) {
  const followUp = await tx.entry.create({
    data: {
      owner,
      kind: parent.kind,
      title: followUpTitle(parent),
      bodyJson: EMPTY_DOC as any,
      bodyText: '',
      occurredAt: at,
      projectId: parent.projectId,
      mentions: { create: contactIds.map((contactId) => ({ contactId })) },
    },
    select: { id: true },
  })

  await tx.entityEdge.create({
    data: {
      owner,
      sourceType: 'entry',
      sourceId: followUp.id,
      targetType: 'entry',
      targetId: parent.id,
      relation: FOLLOWS_UP,
    },
  })

  return followUp
}

/**
 * Applies an edited follow-up date to whichever entry already carries it.
 *
 * Moving the date moves the existing follow-up rather than making a second
 * one: a single conversation was promised, and the date only says which day it
 * lands on. Clearing it withdraws the promise — but only while the note is
 * still empty. Once something has been written into a follow-up it is the
 * record of a conversation that happened, and an emptied date field is not
 * consent to throw that away; deleting the note itself is.
 */
async function syncFollowUp(tx: any, owner: string, parentId: string, at: Date | null) {
  const edge = await tx.entityEdge.findFirst({
    where: {
      owner,
      relation: FOLLOWS_UP,
      sourceType: 'entry',
      targetType: 'entry',
      targetId: parentId,
    },
    orderBy: { createdAt: 'desc' },
    select: { sourceId: true },
  })

  const existing = edge
    ? await tx.entry.findFirst({
        where: { id: edge.sourceId, owner, deletedAt: null },
        select: { id: true, bodyText: true },
      })
    : null

  if (at) {
    if (existing) {
      await tx.entry.update({ where: { id: existing.id }, data: { occurredAt: at } })
      return
    }
    const parent = await tx.entry.findUnique({
      where: { id: parentId, owner },
      select: {
        id: true,
        kind: true,
        title: true,
        projectId: true,
        mentions: { select: { contactId: true } },
      },
    })
    if (!parent) return
    await createFollowUp(
      tx,
      owner,
      parent,
      at,
      parent.mentions.map((m: any) => m.contactId),
    )
    return
  }

  if (existing && existing.bodyText.trim() === '') {
    await tx.entry.update({ where: { id: existing.id }, data: { deletedAt: new Date() } })
  }
}

/**
 * Attaches both ends of the follow-up link to a page of entries: `followUp` is
 * the forward-dated entry that continues this one, `followsUp` the
 * conversation it came out of.
 *
 * Two queries for the whole page rather than the `include` `EntityEdge` cannot
 * offer — it is deliberately type-agnostic, so it holds no Prisma relation back
 * to `Entry`.
 */
async function withFollowUps<T extends { id: string }>(owner: string, rows: T[]) {
  const bare = rows.map((r) => ({
    ...r,
    followUp: null as FollowUpLink | null,
    followsUp: null as FollowUpLink | null,
  }))
  if (rows.length === 0) return bare

  const edges = await followUpEdges(
    owner,
    rows.map((r) => r.id),
  )
  if (edges.length === 0) return bare

  const linked = await prisma.entry.findMany({
    where: {
      owner,
      id: { in: [...new Set(edges.flatMap((e) => [e.sourceId, e.targetId]))] },
      deletedAt: null,
    },
    select: { id: true, kind: true, title: true, occurredAt: true, bodyText: true },
  })

  const byId = new Map<string, FollowUpLink>(
    linked.map((e) => [
      e.id,
      {
        id: e.id,
        kind: e.kind,
        title: e.title,
        occurredAt: e.occurredAt,
        written: e.bodyText.trim().length > 0,
      },
    ]),
  )

  // A note can be followed up more than once over its life. The nearest one is
  // the live commitment, so it wins the single field the card renders.
  const forward = new Map<string, FollowUpLink>()
  const back = new Map<string, FollowUpLink>()
  for (const e of edges) {
    const followUp = byId.get(e.sourceId)
    if (followUp) {
      const held = forward.get(e.targetId)
      if (!held || followUp.occurredAt < held.occurredAt) forward.set(e.targetId, followUp)
    }
    const parent = byId.get(e.targetId)
    if (parent) back.set(e.sourceId, parent)
  }

  return bare.map((r) => ({
    ...r,
    followUp: forward.get(r.id) ?? null,
    followsUp: back.get(r.id) ?? null,
  }))
}

export const entryInclude = {
  project: { select: { id: true, slug: true, name: true, color: true } },
  mentions: {
    include: { contact: { select: { id: true, slug: true, displayName: true, avatarUrl: true } } },
  },
  refs: {
    include: {
      task: { select: { id: true, slug: true, title: true, status: true } },
      project: { select: { id: true, slug: true, name: true, color: true } },
    },
  },
  tags: { include: { tag: true } },
} as const

/**
 * Creates an entry and, in the same transaction, materializes every entity the
 * note referenced inline that did not exist yet.
 *
 * The provisional `new:<uuid>` ids are rewritten to real ids *here*, server-side
 * and inside the transaction. That ordering is what guarantees a failed save
 * leaves behind no orphan contacts and no body pointing at rolled-back rows.
 */
export async function createEntry(owner: string, input: CreateEntryInput) {
  const doc: ProseNode = (input.bodyJson as ProseNode) ?? EMPTY_DOC
  const refs = collectDocRefs(doc)

  // Labels supplied by the client win when present; the document is still the
  // authority on *which* placeholders exist.
  const labelHints = new Map(input.pendingEntities.map((p) => [p.tempId, p.label]))

  return prisma.$transaction(async (tx) => {
    const { idMap, createdEntities, newContactIds, newTaskIds, newProjectIds } =
      await materializePending(tx, owner, refs.pending, labelHints)

    const finalDoc = rewriteDocIds(doc, idMap)
    const bodyText = docToText(finalDoc)

    // Drop references to rows that no longer exist rather than failing the save
    // on a foreign key: a note may cite something deleted since it was written.
    const contactIds = await existingIds(tx.contact, owner, [...refs.contactIds, ...newContactIds])
    const taskIds = await existingIds(tx.task, owner, [...refs.taskIds, ...newTaskIds])
    const projectIds = await existingIds(tx.project, owner, [...refs.projectIds, ...newProjectIds])

    const tagIds = await resolveTagIds(tx as any, owner, input.tags)

    const entry = await tx.entry.create({
      data: {
        owner,
        kind: input.kind,
        // Left null when the writer gave no title; the UI shows 'Untitled'.
        title: input.title?.trim() || null,
        bodyJson: finalDoc as any,
        bodyText,
        occurredAt: input.occurredAt,
        direction: input.direction ?? null,
        durationMin: input.durationMin ?? null,
        location: input.location ?? null,
        // Verified rather than trusted: the picker can hold a project that was
        // deleted while the composer sat open, and a stale id must not fail an
        // otherwise good save.
        projectId: input.projectId
          ? ((await existingIds(tx.project, owner, [input.projectId]))[0] ?? null)
          : null,
        mentions: { create: contactIds.map((contactId) => ({ contactId })) },
        refs: {
          create: [
            ...taskIds.map((taskId) => ({ targetType: 'TASK' as const, taskId })),
            ...projectIds.map((projectId) => ({ targetType: 'PROJECT' as const, projectId })),
          ],
        },
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
      },
      include: entryInclude,
    })

    // Only move `lastContactAt` forward — backfilling an old call must not make
    // someone look more recently contacted than they are.
    //
    // A future entry is not contact at all: dating next week's review forward
    // must not report that you have spoken, or the check-in rail falls silent
    // for everyone whose next meeting is already in the diary — which is
    // precisely the set of people it exists to nudge you about.
    if (contactIds.length > 0 && input.occurredAt <= new Date()) {
      await tx.contact.updateMany({
        where: {
          owner,
          id: { in: contactIds },
          OR: [{ lastContactAt: null }, { lastContactAt: { lt: input.occurredAt } }],
        },
        data: { lastContactAt: input.occurredAt },
      })
    }

    // Inside the transaction: a rolled-back save must not leave a promise to
    // continue a conversation that was never recorded.
    if (input.followUpAt) {
      await createFollowUp(tx, owner, entry, input.followUpAt, contactIds)
    }

    return { entry, createdEntities }
  })
}

/**
 * Materializes every `new:` placeholder a document carries, inside the caller's
 * transaction, and reports the id map so the body can be rewritten to match.
 *
 * Shared by create and update. `updateEntry` used to collect the document's
 * refs but skip its pending ones, so editing a note to add an inline entity
 * stored a `new:<uuid>` in the body permanently: a chip pointing at a row that
 * was never created, with no mention or ref recorded for it.
 */
async function materializePending(
  tx: any,
  owner: string,
  pending: PendingEntity[],
  labelHints: Map<string, string>,
) {
  const idMap = new Map<string, string>()
  const createdEntities: CreatedEntity[] = []
  const takenSlugs = new Set<string>()
  const newContactIds: string[] = []
  const newTaskIds: string[] = []
  const newProjectIds: string[] = []

  for (const p of pending) {
    const label = (labelHints.get(p.tempId) ?? p.label).trim()
    if (!label) continue

    if (p.type === 'contact') {
      const slug = await uniqueSlug('contact', owner, label, tx, takenSlugs)
      const contact = await tx.contact.create({
        data: { owner, slug, displayName: label, isDraft: true },
        select: { id: true },
      })
      idMap.set(p.tempId, contact.id)
      newContactIds.push(contact.id)
      createdEntities.push({ type: 'contact', id: contact.id, label })
    } else if (p.type === 'project') {
      const slug = await uniqueSlug('project', owner, label, tx, takenSlugs)
      const project = await tx.project.create({
        data: { owner, slug, name: label, isDraft: true },
        select: { id: true },
      })
      idMap.set(p.tempId, project.id)
      newProjectIds.push(project.id)
      createdEntities.push({ type: 'project', id: project.id, label })
    } else {
      const slug = await uniqueSlug('task', owner, label, tx, takenSlugs)
      const columnId = await defaultColumnId(tx, owner)
      const position = await appendPosition(tx, owner, columnId)
      const task = await tx.task.create({
        data: { owner, slug, title: label, columnId, position, isDraft: true },
        select: { id: true },
      })
      idMap.set(p.tempId, task.id)
      newTaskIds.push(task.id)
      createdEntities.push({ type: 'task', id: task.id, label })
    }
  }

  return { idMap, createdEntities, newContactIds, newTaskIds, newProjectIds }
}

async function existingIds(delegate: any, owner: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return []
  const rows = await delegate.findMany({
    where: { owner, id: { in: unique } },
    select: { id: true },
  })
  return rows.map((r: { id: string }) => r.id)
}

export async function updateEntry(owner: string, id: string, input: Partial<CreateEntryInput>) {
  return prisma.$transaction(async (tx) => {
    const doc = (input.bodyJson as ProseNode) ?? null
    const data: Record<string, unknown> = {}

    // Captured before anything is rewritten: K14 needs both the entry's date as
    // it stands and the people it currently names, so it can tell who this edit
    // adds and who it drops.
    const before = await tx.entry.findUniqueOrThrow({
      where: { id, owner },
      select: { occurredAt: true, mentions: { select: { contactId: true } } },
    })
    const contactsBefore = before.mentions.map((m: { contactId: string }) => m.contactId)
    let contactsAfter: string[] | null = null

    if (input.kind !== undefined) data.kind = input.kind
    if (input.occurredAt !== undefined) data.occurredAt = input.occurredAt
    if (input.direction !== undefined) data.direction = input.direction ?? null
    if (input.durationMin !== undefined) data.durationMin = input.durationMin ?? null
    if (input.location !== undefined) data.location = input.location ?? null
    if (input.title !== undefined) data.title = input.title?.trim() || null
    if (input.projectId !== undefined) {
      data.projectId = input.projectId
        ? ((await existingIds(tx.project, owner, [input.projectId]))[0] ?? null)
        : null
    }

    let createdEntities: CreatedEntity[] = []

    if (doc) {
      const refs = collectDocRefs(doc)
      // Same job as a first save: create what the edit introduced, then rewrite
      // the body so it points at real rows rather than `new:` placeholders.
      const labelHints = new Map((input.pendingEntities ?? []).map((p) => [p.tempId, p.label]))
      const materialized = await materializePending(tx, owner, refs.pending, labelHints)
      createdEntities = materialized.createdEntities

      const finalDoc = rewriteDocIds(doc, materialized.idMap)
      data.bodyJson = finalDoc as any
      data.bodyText = docToText(finalDoc)

      const contactIds = await existingIds(tx.contact, owner, [
        ...refs.contactIds,
        ...materialized.newContactIds,
      ])
      contactsAfter = contactIds
      const taskIds = await existingIds(tx.task, owner, [
        ...refs.taskIds,
        ...materialized.newTaskIds,
      ])
      const projectIds = await existingIds(tx.project, owner, [
        ...refs.projectIds,
        ...materialized.newProjectIds,
      ])

      await tx.mention.deleteMany({ where: { entryId: id } })
      await tx.entityRef.deleteMany({ where: { entryId: id } })
      if (contactIds.length)
        await tx.mention.createMany({
          data: contactIds.map((contactId) => ({ entryId: id, contactId })),
        })
      if (taskIds.length || projectIds.length)
        await tx.entityRef.createMany({
          data: [
            ...taskIds.map((taskId) => ({ entryId: id, targetType: 'TASK' as const, taskId })),
            ...projectIds.map((projectId) => ({
              entryId: id,
              targetType: 'PROJECT' as const,
              projectId,
            })),
          ],
        })
    }

    if (input.tags) {
      const tagIds = await resolveTagIds(tx as any, owner, input.tags)
      await tx.entryTag.deleteMany({ where: { entryId: id } })
      if (tagIds.length)
        await tx.entryTag.createMany({ data: tagIds.map((tagId) => ({ entryId: id, tagId })) })
    }

    // Same shape as `createEntry`, so a future edit UI can feed newly created
    // drafts into the enrichment queue the way the composer already does.
    const entry = await tx.entry.update({ where: { id }, data, include: entryInclude })

    // After the update, so a follow-up created here inherits the kind, project
    // and people this very save just wrote rather than the ones it replaced.
    if (input.followUpAt !== undefined) await syncFollowUp(tx, owner, id, input.followUpAt ?? null)

    // ── K14 ──────────────────────────────────────────────────────────────────
    // `createEntry` has always advanced `lastContactAt` for the people an entry
    // names. `updateEntry` accepted a new `occurredAt` AND a different contact
    // set, wrote both, and never touched recency — so correcting an entry's
    // date, or adding someone to a conversation already recorded, left those
    // contacts reporting overdue on the check-in rail for ever.
    //
    // Both halves run inside this transaction: recency that disagrees with the
    // entry it was derived from is the bug, so it must not be able to survive a
    // rollback of the entry.
    const resultingContacts = contactsAfter ?? contactsBefore
    const occurredAt = (data.occurredAt as Date | undefined) ?? before.occurredAt

    // Forward-only, and never for an entry that has not happened yet — the same
    // rule and the same reasoning as createEntry.
    if (resultingContacts.length > 0 && occurredAt <= new Date()) {
      await tx.contact.updateMany({
        where: {
          owner,
          id: { in: resultingContacts },
          OR: [{ lastContactAt: null }, { lastContactAt: { lt: occurredAt } }],
        },
        data: { lastContactAt: occurredAt },
      })
    }

    // Contacts this edit dropped: see recomputeLastContact for why these are
    // rebuilt rather than left alone.
    const removed = contactsBefore.filter((c: string) => !resultingContacts.includes(c))
    if (removed.length) await recomputeLastContact(tx, owner, removed)

    return { entry, createdEntities }
  })
}

export async function listEntries(
  owner: string,
  opts: {
    contactId?: string
    taskId?: string
    projectId?: string
    kind?: string
    take?: number
    skip?: number
    /** Only entries that have already occurred. */
    past?: string
    /**
     * Only entries still ahead — what is planned rather than what happened.
     * Ordered nearest-first, because a list of plans reads forwards.
     */
    upcoming?: string
  } = {},
) {
  const { contactId, taskId, projectId, kind, take = 50, skip = 0, past, upcoming } = opts
  const now = new Date()
  const rows = await prisma.entry.findMany({
    where: {
      owner,
      deletedAt: null,
      ...(past ? { occurredAt: { lte: now } } : {}),
      ...(upcoming ? { occurredAt: { gt: now } } : {}),
      ...(kind ? { kind: kind as any } : {}),
      ...(contactId ? { mentions: { some: { contactId } } } : {}),
      ...(taskId ? { refs: { some: { taskId } } } : {}),
      ...(projectId ? { refs: { some: { projectId } } } : {}),
    },
    include: entryInclude,
    orderBy: { occurredAt: upcoming ? 'asc' : 'desc' },
    take,
    skip,
  })
  return withFollowUps(owner, rows)
}

export async function getEntry(owner: string, id: string) {
  const entry = await prisma.entry.findFirst({
    where: { id, owner, deletedAt: null },
    include: entryInclude,
  })
  if (!entry) return null
  return (await withFollowUps(owner, [entry]))[0]
}

/**
 * Soft delete — recoverable from the trash.
 *
 * ⚠️ This used to be `softDelete('entry', id)` and nothing else, which left
 * every contact the entry mentioned carrying a `lastContactAt` sourced from an
 * entry that no longer exists. Trashing a coffee you logged on 1 June still
 * showed that person as last contacted on 1 June, so the check-in rail — whose
 * entire job is to surface people you have drifted from — stayed quiet about
 * someone the app had no record of you meeting.
 *
 * Both statements are in one transaction because the recompute reads the very
 * `deletedAt` the delete writes. Split, a failure between them leaves the entry
 * gone and the recency still pointing at it.
 *
 * The mentions are read BEFORE the delete, and that ordering does not matter
 * today — `Mention` rows survive a soft delete untouched — but it is the order
 * that stays correct if this ever becomes a hard delete, where the cascade
 * would take them.
 */
export async function deleteEntry(owner: string, id: string) {
  return prisma.$transaction(async (tx) => {
    await tx.entry.findFirstOrThrow({ where: { id, owner }, select: { id: true } })
    const contactIds = await contactsMentionedBy(tx, owner, id)
    const row = await tx.entry.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
    await recomputeLastContact(tx, owner, contactIds)
    return row
  })
}

/**
 * Restore a trashed entry, and give back the recency it was carrying.
 *
 * ⚠️ THE TRASH ROUTER DISPATCHES ENTRY RESTORES HERE rather than to the generic
 * `restore()` in `trash.ts`, and that is the whole point. Recomputing on delete
 * without recomputing on restore would be worse than the bug it fixes: the
 * contact would be stuck at the earlier date permanently, with no way back
 * short of editing the entry. A derived column has to be recomputed on every
 * event that changes its inputs, or it is not derived — it is just stale.
 */
export async function restoreEntry(owner: string, id: string) {
  return prisma.$transaction(async (tx) => {
    await tx.entry.findFirstOrThrow({ where: { id, owner }, select: { id: true } })
    const row = await tx.entry.update({ where: { id }, data: { deletedAt: null } })
    await recomputeLastContact(tx, owner, await contactsMentionedBy(tx, owner, id))
    return row
  })
}
