import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CheckInCadence } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ValidationError } from '@/lib/errors'
import { deleteColumn } from '@/lib/services/board'
import { contactsNeedingAttention } from '@/lib/services/cadence'
import { getCalendarEvents } from '@/lib/services/calendar'
import { createContact, getContact, listContacts, updateContact } from '@/lib/services/contacts'
import { deleteEdge, edgesFor, upsertEdge } from '@/lib/services/edges'
import { createEntry, getEntry, listEntries, updateEntry } from '@/lib/services/entries'
import { createProject, getProject, listProjects, updateProject } from '@/lib/services/projects'
import { globalSearch, searchMentions } from '@/lib/services/search'
import { createTask, getBoard, getTask, moveTask, updateTask } from '@/lib/services/tasks'
import { emptyTrash, listTrash, purge, restore, softDelete } from '@/lib/services/trash'
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  exportArchive,
  importArchive,
} from '@/lib/services/archive'
import { CONTACT_MENTION } from '@/lib/tiptap/nodes'
import {
  createEntrySchema,
  upsertContactSchema,
  upsertProjectSchema,
  upsertTaskSchema,
} from '@/lib/validation'

/**
 * P6 ownership isolation: two subjects build the SAME-named graph side by side
 * and every root model, join row and polymorphic edge must stay with its owner.
 *
 * Both subjects are test-only, so every assertion about "the other owner" is
 * made against rows this file created — never against the production-derived
 * data sharing the dev database.
 */
const MARK = `__owntest_${Date.now()}__`
const A = `${MARK}alice`
const B = `${MARK}bob`
const OWNERS = [A, B]
const NAME = `${MARK} Shared Person`
const TAG = `${MARK}work`
const WINDOW = [new Date('2031-01-01T00:00:00Z'), new Date('2031-02-01T00:00:00Z')] as const

const noteWithMention = (text: string, contactId: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text },
        { type: CONTACT_MENTION, attrs: { id: contactId, label: NAME } },
      ],
    },
  ],
})

async function world(owner: string) {
  const contact = await createContact(
    owner,
    upsertContactSchema.parse({ displayName: NAME, tags: [TAG] }),
  )
  const project = await createProject(
    owner,
    upsertProjectSchema.parse({
      name: `${MARK} Shared Project`,
      startDate: '2031-01-10',
    }),
  )
  const task = await createTask(
    owner,
    upsertTaskSchema.parse({
      title: `${MARK} Shared Task`,
      projectId: project.id,
      assigneeIds: [contact.id],
      tags: [TAG],
      dueDate: '2031-01-12',
    }),
  )
  const { entry } = await createEntry(
    owner,
    createEntrySchema.parse({
      kind: 'NOTE',
      bodyJson: noteWithMention(`${MARK} shared note with `, contact.id),
      occurredAt: '2031-01-11T12:00:00Z',
      projectId: project.id,
      tags: [TAG],
    }),
  )
  const edge = await upsertEdge(owner, {
    sourceType: 'contact',
    sourceId: contact.id,
    targetType: 'project',
    targetId: project.id,
    relation: `${MARK}works on`,
  })
  const cadence = Object.values(CheckInCadence).find((c) => c !== 'NONE')!
  await prisma.contact.update({ where: { id: contact.id }, data: { cadence } })
  await prisma.settings.upsert({ where: { owner }, create: { owner, userName: owner }, update: {} })
  return { contact, project, task, entry, edge }
}

type World = Awaited<ReturnType<typeof world>>
let a: World
let b: World

const idsOf = (w: World) => [w.contact.id, w.project.id, w.task.id, w.entry.id, w.edge.id]

beforeAll(async () => {
  a = await world(A)
  b = await world(B)
})

afterAll(async () => {
  for (const owner of OWNERS) {
    await prisma.entityEdge.deleteMany({ where: { owner } })
    await prisma.entry.deleteMany({ where: { owner } })
    await prisma.task.deleteMany({ where: { owner } })
    await prisma.boardColumn.deleteMany({ where: { owner } })
    await prisma.project.deleteMany({ where: { owner } })
    await prisma.contact.deleteMany({ where: { owner } })
    await prisma.tag.deleteMany({ where: { owner } })
    await prisma.settings.deleteMany({ where: { owner } })
  }
  await prisma.$disconnect()
})

describe('owner-aware uniqueness', () => {
  it('lets both owners hold the same slugs and tag names', async () => {
    expect(b.contact.slug).toBe(a.contact.slug)
    expect(b.project.slug).toBe(a.project.slug)
    expect(b.task.slug).toBe(a.task.slug)
    const tags = await prisma.tag.findMany({ where: { name: TAG }, select: { owner: true } })
    expect(tags.map((t) => t.owner).sort()).toEqual([...OWNERS].sort())
  })

  it('keeps exactly one settings row per owner', async () => {
    for (const owner of OWNERS) {
      const rows = await prisma.settings.findMany({ where: { owner } })
      expect(rows).toHaveLength(1)
      expect(rows[0].userName).toBe(owner)
    }
  })
})

describe('reads never cross owners', () => {
  it('resolves ids and slugs only within the caller', async () => {
    expect(await getContact(B, a.contact.id)).toBeNull()
    expect((await getContact(B, a.contact.slug))?.id).toBe(b.contact.id)
    expect(await getProject(B, a.project.id)).toBeNull()
    expect((await getProject(B, a.project.slug))?.id).toBe(b.project.id)
    expect(await getTask(B, a.task.id)).toBeNull()
    expect((await getTask(B, a.task.slug))?.id).toBe(b.task.id)
    expect(await getEntry(B, a.entry.id)).toBeNull()
    await expect(edgesFor(B, 'contact', a.contact.id)).rejects.toThrow()
  })

  it('lists, boards, search, calendar and cadence show only the caller', async () => {
    const aIds = new Set(idsOf(a))
    const leaked = (ids: string[]) => ids.filter((id) => aIds.has(id))

    expect(leaked((await listContacts(B)).map((c) => c.id))).toEqual([])
    expect(leaked((await listProjects(B)).map((p) => p.id))).toEqual([])
    expect(leaked((await getBoard(B, null)).tasks.map((t) => t.id))).toEqual([])
    expect(leaked((await listEntries(B)).map((e) => e.id))).toEqual([])
    expect(leaked((await globalSearch(B, MARK)).map((h) => h.id))).toEqual([])
    expect(leaked((await searchMentions(B, 'contact', 'Shared Person')).map((s) => s.id))).toEqual(
      [],
    )
    expect(leaked((await searchMentions(B, 'entity', `${MARK} Shared`)).map((s) => s.id))).toEqual(
      [],
    )
    expect(leaked((await getCalendarEvents(B, ...WINDOW)).map((e) => e.entityId))).toEqual([])
    expect(leaked((await contactsNeedingAttention(B, 1000)).map((c) => c.id))).toEqual([])

    const edges = await edgesFor(B, 'contact', b.contact.id)
    expect(JSON.stringify(edges)).not.toContain(a.project.id)
  })
})

describe('writes to another owner are refused and change nothing', () => {
  it('refuses updates, moves, edge deletes and trash actions', async () => {
    const [bColumn] = (await getBoard(B, null)).columns

    await expect(
      updateContact(B, a.contact.id, upsertContactSchema.parse({ displayName: 'hijack' })),
    ).rejects.toThrow()
    await expect(
      updateProject(B, a.project.id, upsertProjectSchema.parse({ name: 'hijack' })),
    ).rejects.toThrow()
    await expect(
      updateTask(B, a.task.id, upsertTaskSchema.parse({ title: 'hijack' })),
    ).rejects.toThrow()
    await expect(updateEntry(B, a.entry.id, { title: 'hijack' })).rejects.toThrow()
    await expect(moveTask(B, a.task.id, bColumn.id, 0)).rejects.toThrow()
    await expect(deleteColumn(B, a.task.columnId)).rejects.toThrow()
    await expect(deleteEdge(B, a.edge.id)).rejects.toThrow()
    for (const [kind, id] of [
      ['contact', a.contact.id],
      ['project', a.project.id],
      ['task', a.task.id],
      ['entry', a.entry.id],
    ] as const) {
      await expect(softDelete(B, kind, id)).rejects.toThrow()
      await expect(restore(B, kind, id)).rejects.toThrow()
      await expect(purge(B, kind, id)).rejects.toThrow()
    }

    expect((await getContact(A, a.contact.id))?.displayName).toBe(NAME)
    expect((await getProject(A, a.project.id))?.name).toBe(a.project.name)
    expect((await getTask(A, a.task.id))?.title).toBe(a.task.title)
    expect((await getEntry(A, a.entry.id))?.title ?? null).toBe(a.entry.title ?? null)
    expect(await prisma.entityEdge.findUnique({ where: { id: a.edge.id } })).not.toBeNull()
  })

  it("refuses links from the caller's rows to another owner's rows", async () => {
    await expect(
      createTask(B, upsertTaskSchema.parse({ title: `${MARK}x`, projectId: a.project.id })),
    ).rejects.toThrow()
    await expect(
      createTask(B, upsertTaskSchema.parse({ title: `${MARK}x`, parentTaskId: a.task.id })),
    ).rejects.toThrow()
    await expect(
      createTask(B, upsertTaskSchema.parse({ title: `${MARK}x`, assigneeIds: [a.contact.id] })),
    ).rejects.toThrow()
    await expect(
      createTask(B, upsertTaskSchema.parse({ title: `${MARK}x`, columnId: a.task.columnId })),
    ).rejects.toThrow()
    await expect(moveTask(B, b.task.id, a.task.columnId, 0)).rejects.toThrow()
    await expect(
      upsertEdge(B, {
        sourceType: 'contact',
        sourceId: b.contact.id,
        targetType: 'project',
        targetId: a.project.id,
        relation: `${MARK}x`,
      }),
    ).rejects.toThrow()

    // An entry silently drops references it cannot resolve for its owner.
    const { entry } = await createEntry(
      B,
      createEntrySchema.parse({
        kind: 'NOTE',
        bodyJson: noteWithMention(`${MARK} cross-owner mention `, a.contact.id),
        occurredAt: '2031-01-15T12:00:00Z',
        projectId: a.project.id,
      }),
    )
    expect(entry.mentions).toHaveLength(0)
    expect(entry.projectId).toBeNull()
  })
})

describe('trash is per owner', () => {
  it("lists and empties only the caller's trash", async () => {
    const doomed = await createContact(
      A,
      upsertContactSchema.parse({ displayName: `${MARK} Trashed` }),
    )
    await softDelete(A, 'contact', doomed.id)

    expect((await listTrash(B)).contacts.map((c) => c.id)).not.toContain(doomed.id)
    await emptyTrash(B)
    expect(await prisma.contact.findUnique({ where: { id: doomed.id } })).not.toBeNull()

    expect((await listTrash(A)).contacts.map((c) => c.id)).toContain(doomed.id)
    await purge(A, 'contact', doomed.id)
    expect(await prisma.contact.findUnique({ where: { id: doomed.id } })).toBeNull()
  })
})

describe('archives carry and restore one owner only', () => {
  it("exports none of another owner's rows", async () => {
    const archive = await exportArchive(B)
    // Structural: no archived row IS, or links to, one of A's rows. Free text is
    // not scanned — B's own entry body quotes an A id that B itself typed in the
    // cross-owner mention case above, which resolves to nothing for B.
    const aIds = new Set<unknown>(idsOf(a))
    for (const [model, rows] of Object.entries(archive.data)) {
      for (const row of rows) {
        for (const [field, value] of Object.entries(row)) {
          if (field === 'id' || field.endsWith('Id')) {
            expect(aIds.has(value), `${model}.${field}=${String(value)}`).toBe(false)
          }
        }
      }
    }
    for (const model of [
      'Contact',
      'Project',
      'Task',
      'Entry',
      'EntityEdge',
      'Tag',
      'BoardColumn',
      'Settings',
    ]) {
      for (const row of archive.data[model] ?? []) expect(row.owner).toBe(B)
    }
  })

  it('rejects an archive whose rows link to anything it does not carry', async () => {
    const own = { id: `${MARK}own-contact`, slug: `${MARK}own`, displayName: `${MARK} Own` }
    const base = { format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, migrations: [] }
    const aTag = await prisma.tag.findFirstOrThrow({ where: { owner: A, name: TAG } })

    const hostile = [
      { Contact: [own], ContactTag: [{ contactId: own.id, tagId: aTag.id }] },
      { Contact: [own], TaskAssignee: [{ id: `${MARK}ta`, taskId: a.task.id, contactId: own.id }] },
      {
        Contact: [own],
        EntityEdge: [
          {
            id: `${MARK}edge`,
            sourceType: 'contact',
            sourceId: own.id,
            targetType: 'contact',
            targetId: a.contact.id,
            relation: 'x',
          },
        ],
      },
    ]
    for (const data of hostile) {
      await expect(importArchive(B, { ...base, data })).rejects.toBeInstanceOf(ValidationError)
    }

    // Refused before the transaction: the caller's own graph is intact.
    expect((await getContact(B, b.contact.id))?.id).toBe(b.contact.id)
    expect(
      await prisma.contactTag.count({ where: { tagId: aTag.id, contact: { owner: B } } }),
    ).toBe(0)
  })

  it("round-trips the caller's graph without touching another owner", async () => {
    const countsFor = async (owner: string) => ({
      contacts: await prisma.contact.count({ where: { owner } }),
      entries: await prisma.entry.count({ where: { owner } }),
      tasks: await prisma.task.count({ where: { owner } }),
      edges: await prisma.entityEdge.count({ where: { owner } }),
      mentions: await prisma.mention.count({ where: { entry: { owner } } }),
      settings: await prisma.settings.count({ where: { owner } }),
    })
    const beforeA = await countsFor(A)
    const beforeB = await countsFor(B)

    const archive = JSON.parse(JSON.stringify(await exportArchive(B)))
    await importArchive(B, archive)

    expect(await countsFor(B)).toEqual(beforeB)
    expect(await countsFor(A)).toEqual(beforeA)
    expect((await getContact(B, b.contact.id))?.displayName).toBe(NAME)
    expect((await getContact(A, a.contact.id))?.displayName).toBe(NAME)
  })
})
