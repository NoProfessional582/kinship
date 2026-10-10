import { prisma, type Tx } from '../db'
import { uniqueSlug } from '../slug'
import type { UpsertContactInput } from '../validation'
import { followUpEdges } from './edges'
import { resolveTagIds } from './tags'
import { softDelete } from './trash'
import { ownerTransaction } from '../owner-lock'

/**
 * How many times you have actually spoken to someone. Forward-dated entries are
 * excluded: a follow-up is a real entry with a real mention from the moment it
 * is promised, and counting it would report a conversation you have not had.
 *
 * A function rather than a constant because the cut is "now", and a module-level
 * `new Date()` freezes at import — on a long-running server the badge would
 * quietly stop counting anything logged after boot.
 */
const interactionCount = () => ({
  mentions: { where: { entry: { occurredAt: { lte: new Date() }, deletedAt: null } } },
})

/**
 * A function for the same reason as `interactionCount`, which it embeds.
 */
export const contactDetail = () => ({
  channels: { orderBy: [{ isPreferred: 'desc' as const }, { position: 'asc' as const }] },
  attributes: { orderBy: [{ category: 'asc' as const }, { position: 'asc' as const }] },
  positions: { orderBy: [{ isCurrent: 'desc' as const }, { startDate: 'desc' as const }] },
  milestones: { orderBy: { date: 'desc' as const } },
  links: { orderBy: { position: 'asc' as const } },
  tags: { include: { tag: true } },
  _count: { select: { ...interactionCount(), assignments: true } },
})

export async function listContacts(
  owner: string,
  opts: { q?: string; draftsOnly?: boolean; tag?: string } = {},
) {
  const { q, draftsOnly, tag } = opts
  return prisma.contact.findMany({
    where: {
      owner,
      deletedAt: null,
      ...(draftsOnly ? { isDraft: true } : {}),
      ...(tag ? { tags: { some: { tag: { name: tag } } } } : {}),
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: 'insensitive' as const } },
              { company: { contains: q, mode: 'insensitive' as const } },
              { jobTitle: { contains: q, mode: 'insensitive' as const } },
              { headline: { contains: q, mode: 'insensitive' as const } },
              { nickname: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      slug: true,
      displayName: true,
      avatarUrl: true,
      company: true,
      jobTitle: true,
      headline: true,
      location: true,
      lastContactAt: true,
      isDraft: true,
      interests: true,
      tier: true,
      cadence: true,
      birthday: true,
      _count: { select: interactionCount() },
    },
    orderBy: [{ displayName: 'asc' }],
  })
}

export async function getContact(owner: string, idOrSlug: string) {
  return prisma.contact.findFirst({
    where: { owner, AND: [{ deletedAt: null }, { OR: [{ id: idOrSlug }, { slug: idOrSlug }] }] },
    include: contactDetail(),
  })
}

/**
 * The position marked current is the single source of truth for what someone
 * does now; company/jobTitle on Contact are a denormalized copy so list views,
 * the mention dropdown and the FTS vector stay single-table lookups.
 */
function derivedRole(input: UpsertContactInput) {
  const current = input.positions.find((p) => p.isCurrent)
  if (current) return { company: current.organization ?? null, jobTitle: current.role }
  // No current position: pass the caller's values straight through, undefined
  // included. `contactToPayload` omits both fields entirely, so coercing to
  // null here wiped the company and job title off every contact whose role came
  // from an import rather than a position row — on any save, including one that
  // only touched the nickname, and out of the FTS vector with it. undefined is
  // Prisma's "leave this column alone"; an explicit null still clears it.
  return { company: input.company, jobTitle: input.jobTitle }
}

/** At most one preferred channel; the first flagged one wins. */
function normalizeChannels(input: UpsertContactInput) {
  const firstPreferred = input.channels.findIndex((c) => c.isPreferred)
  return input.channels.map((c, i) => ({
    type: c.type,
    value: c.value,
    label: c.label ?? null,
    isPreferred: i === firstPreferred,
    position: i,
  }))
}

function childRows(input: UpsertContactInput) {
  return {
    channels: { create: normalizeChannels(input) },
    positions: {
      create: input.positions.map((p) => ({
        role: p.role,
        organization: p.organization ?? null,
        team: p.team ?? null,
        startDate: p.startDate ?? null,
        endDate: p.endDate ?? null,
        isCurrent: p.isCurrent,
      })),
    },
    milestones: {
      create: input.milestones.map((m) => ({
        title: m.title,
        date: m.date ?? null,
        note: m.note ?? null,
      })),
    },
    links: {
      create: input.links.map((l, i) => ({ label: l.label, url: l.url, position: i })),
    },
  }
}

function scalarFields(input: UpsertContactInput) {
  const { company, jobTitle } = derivedRole(input)
  return {
    displayName: input.displayName,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    nickname: input.nickname ?? null,
    pronouns: input.pronouns ?? null,
    avatarUrl: input.avatarUrl ?? null,
    headline: input.headline ?? null,
    company,
    jobTitle,
    location: input.location ?? null,
    birthday: input.birthday ?? null,
    tier: input.tier,
    cadence: input.cadence,
    howWeMet: input.howWeMet ?? null,
    bio: input.bio ?? null,
    personalContext: input.personalContext ?? null,
    notes: input.notes ?? null,
    interests: input.interests,
    customFields: input.customFields,
  }
}

/**
 * Replaces a contact's attribute rows. Undefined means the caller is not
 * touching them — the standalone endpoint still owns them for callers that
 * post attributes on their own.
 */
async function replaceAttributes(
  tx: Tx,
  contactId: string,
  rows: UpsertContactInput['attributes'],
) {
  if (rows === undefined) return
  await tx.contactAttribute.deleteMany({ where: { contactId } })
  if (rows.length === 0) return
  await tx.contactAttribute.createMany({
    data: rows.map((a, i) => ({
      contactId,
      category: a.category.trim() || 'Details',
      key: a.key.trim(),
      value: a.value,
      position: i,
    })),
  })
}

export async function createContact(owner: string, input: UpsertContactInput) {
  return ownerTransaction(owner, async (tx) => {
    const slug = await uniqueSlug('contact', owner, input.displayName, tx)
    const tagIds = await resolveTagIds(tx, owner, input.tags)
    const contact = await tx.contact.create({
      data: {
        owner,
        ...scalarFields(input),
        slug,
        isDraft: input.isDraft ?? false,
        ...childRows(input),
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
      },
      select: { id: true },
    })
    await replaceAttributes(tx, contact.id, input.attributes)
    return tx.contact.findUniqueOrThrow({ where: { id: contact.id }, include: contactDetail() })
  })
}

/** Saving from the enrichment modal or the dossier editor clears `isDraft`. */
export async function updateContact(owner: string, id: string, input: UpsertContactInput) {
  return ownerTransaction(owner, async (tx) => {
    await tx.contact.findFirstOrThrow({ where: { id, owner }, select: { id: true } })
    const tagIds = await resolveTagIds(tx, owner, input.tags)

    // Repeatable sections are replaced wholesale; the form always posts the
    // complete list, so diffing rows would add complexity without benefit.
    await tx.contactChannel.deleteMany({ where: { contactId: id } })
    await tx.contactPosition.deleteMany({ where: { contactId: id } })
    await tx.contactMilestone.deleteMany({ where: { contactId: id } })
    await tx.contactLink.deleteMany({ where: { contactId: id } })
    await tx.contactTag.deleteMany({ where: { contactId: id } })
    await replaceAttributes(tx, id, input.attributes)

    return tx.contact.update({
      where: { id },
      data: {
        ...scalarFields(input),
        isDraft: input.isDraft ?? false,
        ...childRows(input),
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
      },
      include: contactDetail(),
    })
  })
}

/** Soft delete — recoverable from the trash. */
export async function deleteContact(owner: string, id: string) {
  return softDelete(owner, 'contact', id)
}

/** The columns the "upcoming" block needs, shared by its two queries. */
const upcomingSelect = {
  id: true,
  kind: true,
  title: true,
  occurredAt: true,
  project: { select: { id: true, slug: true, name: true, color: true } },
} as const

/** Everything the dossier page renders below the header. */
export async function getContactDossier(owner: string, idOrSlug: string) {
  const contact = await getContact(owner, idOrSlug)
  if (!contact) return null

  // Anything still open with this person, queried directly rather than filtered
  // out of the history, which is capped and would drop an old commitment long
  // before you saw it.
  const now = new Date()

  const [entries, tasks, projects, scheduled, openLoops] = await Promise.all([
    // History is what happened. A forward-dated entry has not, and listing it
    // here printed every promised follow-up twice — once under "Upcoming", then
    // again at the top of a history it was not yet part of.
    prisma.entry.findMany({
      where: {
        owner,
        deletedAt: null,
        mentions: { some: { contactId: contact.id } },
        occurredAt: { lte: now },
      },
      include: {
        tags: { include: { tag: true } },
        project: { select: { id: true, slug: true, name: true, color: true } },
      },
      orderBy: { occurredAt: 'desc' },
      take: 100,
    }),
    prisma.task.findMany({
      where: { owner, deletedAt: null, assignees: { some: { contactId: contact.id } } },
      include: {
        project: { select: { id: true, slug: true, name: true, color: true } },
        column: true,
      },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    }),
    prisma.project.findMany({
      where: {
        owner,
        deletedAt: null,
        refs: { some: { entry: { mentions: { some: { contactId: contact.id } } } } },
      },
      select: { id: true, slug: true, name: true, color: true, status: true },
    }),
    // Two bounded queries rather than one OR, because each cap has to keep the
    // rows nearest *now* and the two halves run away from it in opposite
    // directions. A single `take: 25` over the union ordered by occurredAt kept
    // the oldest rows instead: a contact with forty stale commitments filled
    // the block with them and cut every genuinely upcoming item, leaving
    // "Upcoming follow-ups" showing nothing that was upcoming.

    // Planned: everything still ahead of you with this person.
    prisma.entry.findMany({
      where: {
        owner,
        deletedAt: null,
        mentions: { some: { contactId: contact.id } },
        occurredAt: { gt: now },
      },
      select: upcomingSelect,
      orderBy: { occurredAt: 'asc' },
      take: 25,
    }),

    // Open loops: a conversation whose date has passed with nothing written
    // into it. `followUpAt` carried no "done" flag, so this block used to reach
    // back a fixed 30 days and treat the guess as a rule — far enough to keep
    // nagging about a conversation you had already had, not far enough to
    // surface a real commitment made last quarter. An empty body answers the
    // question outright, and a loop you no longer want is closed by deleting
    // the note, which `followUpAt` gave you no way to do.
    //
    // Fetched wider than it is shown, because being a follow-up is an edge and
    // cannot be joined here; the filter below is what narrows it.
    prisma.entry.findMany({
      where: {
        owner,
        deletedAt: null,
        mentions: { some: { contactId: contact.id } },
        occurredAt: { lte: now },
        bodyText: '',
      },
      select: upcomingSelect,
      orderBy: { occurredAt: 'desc' },
      take: 50,
    }),
  ])

  const candidates = [...scheduled, ...openLoops].filter(
    (e, i, all) => all.findIndex((o) => o.id === e.id) === i,
  )

  // Which of them continue an earlier conversation, so the block can colour a
  // promised call differently from a dinner you simply have in the diary.
  const followUpIds = new Set(
    (
      await followUpEdges(
        owner,
        candidates.map((e) => e.id),
      )
    ).map((e) => e.sourceId),
  )

  const upcoming = candidates
    // Emptiness only means "never happened" for something that was planned. An
    // ordinary note saved with a title and no body — "sent the flowers" — is
    // finished, not overdue, and would otherwise nag from this block forever.
    .filter((e) => e.occurredAt > now || followUpIds.has(e.id))
    .map((e) => ({
      ...e,
      isFollowUp: followUpIds.has(e.id),
      openLoop: e.occurredAt <= now,
    }))

  return { contact, entries, tasks, projects, upcoming }
}
