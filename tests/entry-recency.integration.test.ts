import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import {
  createEntry as createEntryOwned,
  deleteEntry as deleteEntryOwned,
  restoreEntry as restoreEntryOwned,
  updateEntry as updateEntryOwned,
} from '@/lib/services/entries'
import { createEntrySchema, type CreateEntryInput } from '@/lib/validation'
import { CONTACT_MENTION } from '@/lib/tiptap/nodes'
import { rescheduleEvent } from '@/lib/services/calendar'
import { exportArchive, importArchive } from '@/lib/services/archive'
import { contend } from './support/owner-contention'

/**
 * `lastContactAt` maintenance across entry edits (K14).
 *
 * The column is wholly derived from entries — `createEntry` was the only thing
 * that ever wrote it — so every assertion here is about it agreeing with the
 * entries that remain.
 */
const MARK = `__recency_${Date.now()}__`
const OWNER = `${MARK}owner`
const createEntry = (input: CreateEntryInput) => createEntryOwned(OWNER, input)
const updateEntry = (id: string, input: Partial<CreateEntryInput>) =>
  updateEntryOwned(OWNER, id, input)
const deleteEntry = (id: string) => deleteEntryOwned(OWNER, id)
const restoreEntry = (id: string) => restoreEntryOwned(OWNER, id)
const days = (n: number) => new Date(Date.now() + n * 86_400_000)
const at = (d: Date) => d.toISOString().slice(0, 10)

const contact = (name: string) =>
  prisma.contact.create({
    data: {
      owner: OWNER,
      slug: `${MARK}${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      displayName: `${MARK}${name}`,
    },
  })

/** A body that mentions the given contacts, in the shape the composer produces. */
const body = (ids: string[]) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: `${MARK} spoke with ` },
        ...ids.map((id) => ({ type: CONTACT_MENTION, attrs: { id, label: 'x' } })),
      ],
    },
  ],
})

/** Through the schema, so defaults (pendingEntities, kind, …) are supplied. */
const make = (fields: Record<string, unknown>) => createEntry(createEntrySchema.parse(fields))

const lastContact = async (id: string) =>
  (await prisma.contact.findUniqueOrThrow({ where: { id }, select: { lastContactAt: true } }))
    .lastContactAt

afterAll(async () => {
  const entries = await prisma.entry.findMany({
    where: { owner: OWNER },
    select: { id: true },
  })
  const ids = entries.map((e) => e.id)
  await prisma.mention.deleteMany({ where: { entryId: { in: ids } } })
  await prisma.entryTag.deleteMany({ where: { entryId: { in: ids } } })
  await prisma.entityRef.deleteMany({ where: { entryId: { in: ids } } })
  await prisma.entry.deleteMany({ where: { id: { in: ids } } })
  await prisma.contact.deleteMany({ where: { displayName: { startsWith: MARK } } })
  await prisma.entityEdge.deleteMany({ where: { owner: OWNER } })
  await prisma.$disconnect()
})

describe('updateEntry — recency follows the edit (K14)', () => {
  it('moves recency forward when an entry is re-dated forward', async () => {
    const a = await contact('fwd')
    const { entry } = await make({
      title: `${MARK}fwd`,
      kind: 'NOTE',
      occurredAt: days(-10),
      bodyJson: body([a.id]),
    })
    expect(at((await lastContact(a.id)) as Date)).toBe(at(days(-10)))

    await updateEntry(entry.id, { occurredAt: days(-2), bodyJson: body([a.id]) })

    expect(at((await lastContact(a.id)) as Date)).toBe(at(days(-2)))
  })

  it('gives a contact ADDED to an existing conversation its recency', async () => {
    const a = await contact('had')
    const b = await contact('added')
    const { entry } = await make({
      title: `${MARK}add`,
      kind: 'NOTE',
      occurredAt: days(-3),
      bodyJson: body([a.id]),
    })
    expect(await lastContact(b.id)).toBeNull()

    await updateEntry(entry.id, { bodyJson: body([a.id, b.id]) })

    // Before K14 this stayed null and b kept reporting overdue for ever.
    expect(at((await lastContact(b.id)) as Date)).toBe(at(days(-3)))
    expect(at((await lastContact(a.id)) as Date)).toBe(at(days(-3)))
  })

  it('moves recency backwards when the only supporting entry is backdated', async () => {
    const a = await contact('back')
    const { entry } = await make({
      title: `${MARK}back`,
      kind: 'NOTE',
      occurredAt: days(-2),
      bodyJson: body([a.id]),
    })
    await updateEntry(entry.id, { occurredAt: days(-30) })

    expect(at((await lastContact(a.id)) as Date)).toBe(at(days(-30)))
  })

  it('does not treat a future entry as contact', async () => {
    const a = await contact('future')
    const { entry } = await make({
      title: `${MARK}future`,
      kind: 'NOTE',
      occurredAt: days(-8),
      bodyJson: body([a.id]),
    })
    await updateEntry(entry.id, { occurredAt: days(+5) })

    expect(await lastContact(a.id)).toBeNull()
  })

  it('REMOVED contact: recency falls back to the entries that remain', async () => {
    const a = await contact('removed')
    await make({ title: `${MARK}old`, kind: 'NOTE', occurredAt: days(-20), bodyJson: body([a.id]) })
    const { entry } = await make({
      title: `${MARK}recent`,
      kind: 'NOTE',
      occurredAt: days(-1),
      bodyJson: body([a.id]),
    })
    expect(at((await lastContact(a.id)) as Date)).toBe(at(days(-1)))

    // Retract the recent mention: the older entry is now the truth.
    await updateEntry(entry.id, { bodyJson: body([]) })

    expect(at((await lastContact(a.id)) as Date)).toBe(at(days(-20)))
  })

  it('REMOVED contact with nothing left: recency returns to null', async () => {
    const a = await contact('onlyone')
    const { entry } = await make({
      title: `${MARK}only`,
      kind: 'NOTE',
      occurredAt: days(-4),
      bodyJson: body([a.id]),
    })
    expect(await lastContact(a.id)).not.toBeNull()

    await updateEntry(entry.id, { bodyJson: body([]) })

    expect(await lastContact(a.id)).toBeNull()
  })
})

/**
 * Trashing an entry is a RETRACTION, exactly like removing a mention from one.
 *
 * `deleteEntry` used to soft-delete and stop, so a contact kept a recency
 * sourced from an entry that no longer existed and the check-in rail stayed
 * quiet about someone the app had no record of you meeting. Reverting
 * `deleteEntry` to `softDelete('entry', id)` turns all four of these red.
 */
describe('deleteEntry / restoreEntry — recency follows the trash', () => {
  it('trashing the only entry returns recency to null', async () => {
    const a = await contact('del-only')
    const { entry } = await make({
      title: `${MARK}delonly`,
      kind: 'NOTE',
      occurredAt: days(-3),
      bodyJson: body([a.id]),
    })
    expect(await lastContact(a.id)).not.toBeNull()

    await deleteEntry(entry.id)

    expect(await lastContact(a.id)).toBeNull()
  })

  it('trashing the most recent entry falls back to the one that remains', async () => {
    const a = await contact('del-fallback')
    await make({
      title: `${MARK}delold`,
      kind: 'NOTE',
      occurredAt: days(-20),
      bodyJson: body([a.id]),
    })
    const { entry } = await make({
      title: `${MARK}delnew`,
      kind: 'NOTE',
      occurredAt: days(-1),
      bodyJson: body([a.id]),
    })
    expect(at((await lastContact(a.id)) as Date)).toBe(at(days(-1)))

    await deleteEntry(entry.id)

    expect(at((await lastContact(a.id)) as Date)).toBe(at(days(-20)))
  })

  it('restoring it puts the recency back — the half-fix would leave it stuck', async () => {
    const a = await contact('restore')
    await make({
      title: `${MARK}resold`,
      kind: 'NOTE',
      occurredAt: days(-20),
      bodyJson: body([a.id]),
    })
    const { entry } = await make({
      title: `${MARK}resnew`,
      kind: 'NOTE',
      occurredAt: days(-1),
      bodyJson: body([a.id]),
    })

    await deleteEntry(entry.id)
    expect(at((await lastContact(a.id)) as Date)).toBe(at(days(-20)))

    await restoreEntry(entry.id)

    expect(at((await lastContact(a.id)) as Date)).toBe(at(days(-1)))
  })

  it('trashing an entry leaves contacts it never mentioned alone', async () => {
    const a = await contact('del-subject')
    const b = await contact('del-bystander')
    await make({ title: `${MARK}delb`, kind: 'NOTE', occurredAt: days(-6), bodyJson: body([b.id]) })
    const { entry } = await make({
      title: `${MARK}dela`,
      kind: 'NOTE',
      occurredAt: days(-2),
      bodyJson: body([a.id]),
    })
    const bBefore = await lastContact(b.id)

    await deleteEntry(entry.id)

    expect(await lastContact(a.id)).toBeNull()
    expect(at((await lastContact(b.id)) as Date)).toBe(at(bBefore as Date))
  })
})

describe('recency across every date mutation', () => {
  it('falls back to the latest remaining entry after backdating or a calendar drag', async () => {
    const a = await contact('date-fallback')
    const older = days(-10)
    await make({ title: `${MARK}fallback-old`, occurredAt: older, bodyJson: body([a.id]) })
    const { entry } = await make({
      title: `${MARK}fallback-new`,
      occurredAt: days(-1),
      bodyJson: body([a.id]),
    })
    await updateEntry(entry.id, { occurredAt: days(-30) })
    expect(await lastContact(a.id)).toEqual(older)
    await rescheduleEvent(OWNER, 'entry', entry.id, days(-2))
    expect(at((await lastContact(a.id))!)).toBe(at(days(-2)))
    await rescheduleEvent(OWNER, 'entry', entry.id, days(10))
    expect(await lastContact(a.id)).toEqual(older)
  })

  it('recomputes people on an edited or withdrawn follow-up', async () => {
    const a = await contact('followup')
    const old = days(-20)
    const { entry } = await make({
      title: `${MARK}followup`,
      occurredAt: old,
      bodyJson: body([a.id]),
      followUpAt: days(-2),
    })
    expect(at((await lastContact(a.id))!)).toBe(at(days(-2)))
    await updateEntry(entry.id, { followUpAt: days(-8) })
    expect(at((await lastContact(a.id))!)).toBe(at(days(-8)))
    await updateEntry(entry.id, { followUpAt: null })
    expect(await lastContact(a.id)).toEqual(old)
  })

  it('serializes concurrent edits affecting one contact', async () => {
    const a = await contact('concurrent')
    const { entry: first } = await make({
      title: `${MARK}race-first`,
      occurredAt: days(-1),
      bodyJson: body([a.id]),
    })
    const { entry: second } = await make({
      title: `${MARK}race-second`,
      occurredAt: days(-2),
      bodyJson: body([a.id]),
    })
    const expected = days(-10)
    const results = await contend(OWNER, [
      () => updateEntry(first.id, { occurredAt: days(10) }),
      () => updateEntry(second.id, { occurredAt: expected }),
    ])
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    expect(await lastContact(a.id)).toEqual(expected)
  })

  it('rebuilds stale archive recency instead of trusting the cached field', async () => {
    const owner = `${OWNER}-import`
    const c = await prisma.contact.create({
      data: { owner, slug: 'archive-contact', displayName: 'Archive contact' },
    })
    const expected = days(-7)
    await createEntryOwned(
      owner,
      createEntrySchema.parse({ occurredAt: expected, bodyJson: body([c.id]) }),
    )
    try {
      const archive = await exportArchive(owner)
      archive.data.Contact[0].lastContactAt = days(30).toISOString()
      await importArchive(owner, archive)
      expect(await lastContact(c.id)).toEqual(expected)
    } finally {
      await prisma.entry.deleteMany({ where: { owner } })
      await prisma.contact.deleteMany({ where: { owner } })
    }
  })
})

it('a valid archive round trip preserves contact modification metadata', async () => {
  const owner = `${OWNER}-metadata`
  const c = await prisma.contact.create({
    data: { owner, slug: 'metadata', displayName: 'Metadata contact' },
  })
  try {
    await createEntryOwned(
      owner,
      createEntrySchema.parse({ occurredAt: days(-7), bodyJson: body([c.id]) }),
    )
    const before = await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })
    await importArchive(owner, await exportArchive(owner))
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).toEqual(before)
  } finally {
    await prisma.entry.deleteMany({ where: { owner } })
    await prisma.contact.deleteMany({ where: { owner } })
  }
})
