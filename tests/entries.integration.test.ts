import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import {
  createEntry as createEntryOwned,
  updateEntry as updateEntryOwned,
  getEntry as getEntryOwned,
  listEntries as listEntriesOwned,
} from '@/lib/services/entries'
import { FOLLOWS_UP } from '@/lib/relations'
import { deleteEdgesFor as deleteOwnedEdges, type TrashKind } from '@/lib/services/trash'
import { createEntrySchema, updateEntrySchema, type CreateEntryInput } from '@/lib/validation'
import { ValidationError } from '@/lib/errors'
import { CONTACT_MENTION, ENTITY_REF } from '@/lib/tiptap/nodes'

/**
 * Exercises the save transaction against a real database. Run inside the
 * compose network, where DATABASE_URL points at the db service:
 *   docker compose run --rm migrate npm run test:integration -- tests/entries.integration.test.ts
 */
const MARK = `__itest_${Date.now()}__`
const OWNER = `${MARK}owner`
const createEntry = (input: CreateEntryInput) => createEntryOwned(OWNER, input)
const updateEntry = (id: string, input: Partial<CreateEntryInput>) =>
  updateEntryOwned(OWNER, id, input)
const getEntry = (id: string) => getEntryOwned(OWNER, id)
const deleteEdgesFor = (kind: TrashKind, ids: string[]) => deleteOwnedEdges(OWNER, kind, ids)

const bodyWith = (label: string, project: string, task: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: `${MARK} call with ` },
        { type: CONTACT_MENTION, attrs: { id: 'new:c', label } },
        { type: 'text', text: ' about ' },
        { type: ENTITY_REF, attrs: { id: 'new:p', kind: 'project', label: project } },
        { type: 'text', text: ' owning ' },
        { type: ENTITY_REF, attrs: { id: 'new:t', kind: 'task', label: task } },
        { type: 'text', text: ' and again ' },
        { type: CONTACT_MENTION, attrs: { id: 'new:c', label } },
      ],
    },
  ],
})

const pending = (label: string, project: string, task: string) => [
  { tempId: 'new:c', type: 'contact' as const, label },
  { tempId: 'new:p', type: 'project' as const, label: project },
  { tempId: 'new:t', type: 'task' as const, label: task },
]

afterAll(async () => {
  // A follow-up carries its parent's title and an empty body, so the sweep has
  // to look at both columns or every run leaves one behind.
  const mine = { OR: [{ bodyText: { contains: MARK } }, { title: { contains: MARK } }] }
  const byName = { displayName: { startsWith: MARK } }
  const byTitle = { title: { startsWith: MARK } }
  const byProject = { name: { startsWith: MARK } }

  // An edge holds a bare id rather than a relation, so there is no foreign key
  // to cascade and no way back to the id once the row is gone. Read first.
  const id = (rows: { id: string }[]) => rows.map((r) => r.id)
  const [entries, contacts, tasks, projects] = await Promise.all([
    prisma.entry.findMany({ where: mine, select: { id: true } }),
    prisma.contact.findMany({ where: byName, select: { id: true } }),
    prisma.task.findMany({ where: byTitle, select: { id: true } }),
    prisma.project.findMany({ where: byProject, select: { id: true } }),
  ])

  await prisma.entry.deleteMany({ where: mine })
  await prisma.contact.deleteMany({ where: byName })
  await prisma.task.deleteMany({ where: byTitle })
  await prisma.project.deleteMany({ where: byProject })
  // Creating a task also creates its owner's default board columns, and every
  // column of this run's test owner is one this file made.
  await prisma.boardColumn.deleteMany({ where: { owner: OWNER } })

  await Promise.all([
    deleteEdgesFor('entry', id(entries)),
    deleteEdgesFor('contact', id(contacts)),
    deleteEdgesFor('task', id(tasks)),
    deleteEdgesFor('project', id(projects)),
  ])
  await prisma.$disconnect()
})

describe('createEntry transaction', () => {
  it('materializes exactly one row per placeholder and rewrites the body', async () => {
    const label = `${MARK}Person`
    const project = `${MARK}Project`
    const task = `${MARK}Task`

    const { entry, createdEntities } = await createEntry(
      createEntrySchema.parse({
        kind: 'CALL',
        bodyJson: bodyWith(label, project, task),
        pendingEntities: pending(label, project, task),
      }),
    )

    expect(createdEntities).toHaveLength(3)
    expect(createdEntities.map((e) => e.type).sort()).toEqual(['contact', 'project', 'task'])

    // The repeated placeholder must not have produced a second person.
    expect(await prisma.contact.count({ where: { displayName: label } })).toBe(1)
    expect(entry.mentions).toHaveLength(1)
    expect(entry.refs).toHaveLength(2)

    // Nothing provisional may survive the save.
    expect(JSON.stringify(entry.bodyJson)).not.toContain('new:')
    const contactId = createdEntities.find((e) => e.type === 'contact')!.id
    expect(JSON.stringify(entry.bodyJson)).toContain(contactId)

    // Inline-created rows land in the draft tray until enrichment saves them.
    const created = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })
    expect(created.isDraft).toBe(true)
    expect(created.lastContactAt).not.toBeNull()

    const createdTask = await prisma.task.findFirstOrThrow({ where: { title: task } })
    expect(createdTask.isDraft).toBe(true)
    expect(createdTask.columnId).toBeTruthy()
  })

  it('rolls every new entity back when the save fails', async () => {
    const label = `${MARK}Ghost`
    const before = {
      contacts: await prisma.contact.count(),
      tasks: await prisma.task.count(),
      projects: await prisma.project.count(),
      entries: await prisma.entry.count(),
    }

    const input = createEntrySchema.parse({
      kind: 'NOTE',
      bodyJson: bodyWith(label, `${MARK}GhostProject`, `${MARK}GhostTask`),
      pendingEntities: pending(label, `${MARK}GhostProject`, `${MARK}GhostTask`),
    })
    // Overflow the Int column *after* validation, so the failure lands on the
    // entry insert -- by which point all three entities already exist inside
    // the transaction. That is precisely what the rollback has to undo.
    input.durationMin = 2_147_483_648

    await expect(createEntry(input)).rejects.toThrow()

    expect(await prisma.contact.count()).toBe(before.contacts)
    expect(await prisma.task.count()).toBe(before.tasks)
    expect(await prisma.project.count()).toBe(before.projects)
    expect(await prisma.entry.count()).toBe(before.entries)
    expect(await prisma.contact.count({ where: { displayName: label } })).toBe(0)
  })

  it('keeps lastContactAt monotonic when backfilling an older call', async () => {
    const label = `${MARK}Monotonic`
    const { createdEntities } = await createEntry(
      createEntrySchema.parse({
        kind: 'CALL',
        occurredAt: new Date('2026-08-01T10:00:00Z'),
        bodyJson: bodyWith(label, `${MARK}MP`, `${MARK}MT`),
        pendingEntities: pending(label, `${MARK}MP`, `${MARK}MT`),
      }),
    )
    const id = createdEntities.find((e) => e.type === 'contact')!.id
    const recent = await prisma.contact.findUniqueOrThrow({ where: { id } })

    // A later save for an *earlier* date must not drag the value backwards.
    await createEntry(
      createEntrySchema.parse({
        kind: 'EMAIL',
        occurredAt: new Date('2020-01-01T10:00:00Z'),
        bodyJson: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: MARK },
                { type: CONTACT_MENTION, attrs: { id, label } },
              ],
            },
          ],
        },
        pendingEntities: [],
      }),
    )

    const after = await prisma.contact.findUniqueOrThrow({ where: { id } })
    expect(after.lastContactAt?.toISOString()).toBe(recent.lastContactAt?.toISOString())
  })
})

/**
 * A follow-up is a second entry, not a column. These cover the three things
 * that has to mean: the row exists and is linked, the promise inherits the
 * people it was made to, and editing the date moves that row rather than
 * breeding another.
 */
describe('follow-ups', () => {
  const noteFor = (id: string, label: string) => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: `${MARK} spoke to ` },
          { type: CONTACT_MENTION, attrs: { id, label } },
        ],
      },
    ],
  })

  /** Creates a parent with one mention and returns both it and the contact. */
  const seed = async (name: string, followUpAt?: Date) => {
    const label = `${MARK}${name}`
    const { entry: seeded } = await createEntry(
      createEntrySchema.parse({
        kind: 'CALL',
        title: `${MARK}${name}`,
        bodyJson: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: `${MARK} first call ` },
                { type: CONTACT_MENTION, attrs: { id: 'new:c', label } },
              ],
            },
          ],
        },
        pendingEntities: [{ tempId: 'new:c', type: 'contact', label }],
        ...(followUpAt ? { followUpAt } : {}),
      }),
    )
    return { parent: seeded, contactId: seeded.mentions[0].contactId, label }
  }

  it('spins the promise off into its own linked entry', async () => {
    const at = new Date(Date.now() + 7 * 86400000)
    const { parent, contactId } = await seed('Spin', at)

    const edge = await prisma.entityEdge.findFirstOrThrow({
      where: {
        relation: FOLLOWS_UP,
        sourceType: 'entry',
        targetType: 'entry',
        targetId: parent.id,
      },
    })

    const followUp = await prisma.entry.findUniqueOrThrow({
      where: { id: edge.sourceId },
      include: { mentions: true },
    })

    expect(followUp.occurredAt.toISOString()).toBe(at.toISOString())
    expect(followUp.title).toBe(`Follow up — ${parent.title}`)
    // Inherited, so the promise reaches the dossier of the person it was made to.
    expect(followUp.kind).toBe(parent.kind)
    expect(followUp.mentions.map((m) => m.contactId)).toEqual([contactId])
    // Empty on purpose: that is the only record of "this has not happened yet".
    expect(followUp.bodyText).toBe('')

    // Both ends are readable from the entry itself.
    const loaded = await getEntry(parent.id)
    expect(loaded?.followUp?.id).toBe(followUp.id)
    expect(loaded?.followUp?.written).toBe(false)
    expect((await getEntry(followUp.id))?.followsUp?.id).toBe(parent.id)
  })

  it('does not count a forward-dated promise as contact', async () => {
    const { contactId } = await seed('Future', new Date(Date.now() + 30 * 86400000))
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })
    // The parent happened now, the follow-up has not happened at all.
    expect(contact.lastContactAt!.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('moves the existing follow-up rather than making a second one', async () => {
    const { parent } = await seed('Move', new Date(Date.now() + 3 * 86400000))
    const moved = new Date(Date.now() + 9 * 86400000)

    await updateEntry(parent.id, { followUpAt: moved })

    const edges = await prisma.entityEdge.findMany({
      where: { relation: FOLLOWS_UP, targetId: parent.id },
    })
    expect(edges).toHaveLength(1)
    expect((await getEntry(parent.id))?.followUp?.occurredAt.toISOString()).toBe(
      moved.toISOString(),
    )
  })

  it('creates one on an entry that was saved without a date', async () => {
    const { parent } = await seed('Late')
    expect((await getEntry(parent.id))?.followUp).toBeNull()

    await updateEntry(parent.id, { followUpAt: new Date(Date.now() + 2 * 86400000) })
    expect((await getEntry(parent.id))?.followUp).not.toBeNull()
  })

  it('withdraws an empty promise when the date is cleared, and keeps a written one', async () => {
    const { parent: empty } = await seed('Withdraw', new Date(Date.now() + 4 * 86400000))
    await updateEntry(empty.id, { followUpAt: null })
    expect((await getEntry(empty.id))?.followUp).toBeNull()

    const { parent: kept, contactId } = await seed('Kept', new Date(Date.now() + 4 * 86400000))
    const followUpId = (await getEntry(kept.id))!.followUp!.id

    // Write the conversation up, then clear the field. A record of something
    // that happened is not thrown away by emptying a date on another note.
    await updateEntry(followUpId, {
      bodyJson: noteFor(contactId, `${MARK}Kept`),
      pendingEntities: [],
    })
    await updateEntry(kept.id, { followUpAt: null })

    const still = await getEntry(kept.id)
    expect(still?.followUp?.id).toBe(followUpId)
    expect(still?.followUp?.written).toBe(true)
  })
})

describe('plain-text body', () => {
  const save = (fields: Record<string, unknown>) => createEntry(createEntrySchema.parse(fields))
  const edit = (id: string, fields: Record<string, unknown>) =>
    updateEntry(id, updateEntrySchema.parse(fields))

  it('links an existing contact, task and project, and answers with the same body', async () => {
    const { entry: seed } = await save({ body: `${MARK} seed with @[${MARK}Ana](contact:new)` })
    const ana = seed.mentions[0].contact
    const { entry: withRecords } = await save({
      body: `${MARK} seed [[${MARK}Ship]](task:new) [[${MARK}Launch]](project:new)`,
    })
    const task = withRecords.refs.find((r) => r.targetType === 'TASK')!.task!
    const project = withRecords.refs.find((r) => r.targetType === 'PROJECT')!.project!

    const body =
      `${MARK} lunch with @[${MARK}Ana](contact:${ana.id})\n\n` +
      `- [[${MARK}Ship]](task:${task.id})\n- [[${MARK}Launch]](project:${project.id})`
    const { entry, createdEntities } = await save({ body })

    expect(createdEntities).toEqual([])
    expect(entry.body).toBe(body)
    expect(entry.mentions.map((m) => m.contactId)).toEqual([ana.id])
    expect(entry.refs.map((r) => r.taskId ?? r.projectId).sort()).toEqual(
      [task.id, project.id].sort(),
    )
    expect(entry.bodyText).toContain(`@${MARK}Ana`)
    expect((await getEntry(entry.id))!.body).toBe(body)
  })

  it('creates a `new` contact, links it and puts the note on their timeline', async () => {
    const { entry, createdEntities } = await save({
      kind: 'CALL',
      body: `${MARK} called @[${MARK}Bo](contact:new), then @[${MARK}Bo](contact:new) again`,
    })

    expect(createdEntities).toHaveLength(1)
    const bo = createdEntities[0]
    expect(bo).toMatchObject({ type: 'contact', label: `${MARK}Bo` })
    expect(entry.body).toBe(
      `${MARK} called @[${MARK}Bo](contact:${bo.id}), then @[${MARK}Bo](contact:${bo.id}) again`,
    )
    const timeline = await listEntriesOwned(OWNER, { contactId: bo.id })
    expect(timeline.map((e) => e.id)).toEqual([entry.id])
    expect(timeline[0].body).toBe(entry.body)
    expect(
      (await prisma.contact.findUniqueOrThrow({ where: { id: bo.id } })).lastContactAt,
    ).not.toBeNull()
  })

  it('creates a `new` task and project', async () => {
    const { entry, createdEntities } = await save({
      body: `${MARK} plan [[${MARK}Draft]](task:new) for [[${MARK}Fair]](project:new)`,
    })
    expect(createdEntities.map((c) => c.type).sort()).toEqual(['project', 'task'])
    expect(entry.refs).toHaveLength(2)
    expect(entry.body).not.toContain(':new)')
  })

  it('refuses a mention of an id the owner does not have, and saves nothing', async () => {
    const before = await prisma.contact.count({ where: { owner: OWNER } })
    await expect(
      save({
        body: `${MARK} @[${MARK}Ghost](contact:nosuchid) and @[${MARK}Cy](contact:new)`,
      }),
    ).rejects.toThrow(ValidationError)
    await expect(save({ body: `${MARK} [[${MARK}X]](task:nosuchid)` })).rejects.toThrow(
      /task:nosuchid/,
    )
    expect(await prisma.contact.count({ where: { owner: OWNER } })).toBe(before)
  })

  it('replaces the note on PATCH and rewrites its mentions', async () => {
    const { entry } = await save({ body: `${MARK} first @[${MARK}Di](contact:new)` })
    const di = entry.mentions[0].contactId

    const { entry: edited, createdEntities } = await edit(entry.id, {
      body: `${MARK} second @[${MARK}Ed](contact:new)`,
    })
    expect(createdEntities).toHaveLength(1)
    expect(edited.body).toBe(`${MARK} second @[${MARK}Ed](contact:${createdEntities[0].id})`)
    expect(edited.mentions.map((m) => m.contactId)).toEqual([createdEntities[0].id])
    expect(edited.mentions.map((m) => m.contactId)).not.toContain(di)

    await expect(edit(entry.id, { body: `${MARK} @[x](contact:nosuchid)` })).rejects.toThrow(
      ValidationError,
    )
    expect((await getEntry(entry.id))!.body).toBe(edited.body)

    const { entry: titled } = await edit(entry.id, { title: `${MARK} renamed` })
    expect(titled.body).toBe(edited.body)
  })

  it('reads a bodyJson note back as body', async () => {
    const label = `${MARK}Fay`
    const { entry, createdEntities } = await save({
      bodyJson: bodyWith(label, `${MARK}P2`, `${MARK}T2`),
      pendingEntities: pending(label, `${MARK}P2`, `${MARK}T2`),
    })
    const id = (type: string) => createdEntities.find((c) => c.type === type)!.id
    expect(entry.body).toBe(
      `${MARK} call with @[${label}](contact:${id('contact')}) about ` +
        `[[${MARK}P2]](project:${id('project')}) owning [[${MARK}T2]](task:${id('task')}) ` +
        `and again @[${label}](contact:${id('contact')})`,
    )
  })
})
