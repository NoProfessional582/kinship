import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { NotFoundError } from '@/lib/errors'
import { INFERRED } from '@/lib/graph/constants'
import { parseGraphQuery } from '@/lib/graph/focus'
import { getGraph } from '@/lib/services/graph'

/**
 * The 3D map's graph against a real database: two test-only owners build the same
 * records side by side, with the same names and slugs, and then a set of join rows
 * that should never exist — one owner's entry mentioning the other's contact, and so
 * on. The database allows them (join tables carry no owner), so the graph has to
 * refuse them itself. Everything here is made directly with Prisma, so the rows can
 * be as inconsistent as the test needs, and removed afterwards by owner.
 */
const MARK = `__graphtest_${Date.now()}__`
const A = `${MARK}alice`
const B = `${MARK}bob`
const OWNERS = [A, B]
const body = { type: 'doc', content: [] }

const whole = parseGraphQuery(new URLSearchParams())
const focus = (id: string, depth?: 1 | 2) =>
  parseGraphQuery(new URLSearchParams({ focusId: id, ...(depth ? { depth: String(depth) } : {}) }))

async function world(owner: string) {
  const column = await prisma.boardColumn.create({ data: { owner, name: 'To do', position: 1 } })
  const contact = (slug: string, extra: object = {}) =>
    prisma.contact.create({ data: { owner, slug, displayName: `${MARK} ${slug}`, ...extra } })
  const project = (slug: string, extra: object = {}) =>
    prisma.project.create({ data: { owner, slug, name: `${MARK} ${slug}`, ...extra } })
  const task = (slug: string, extra: object = {}) =>
    prisma.task.create({
      data: { owner, slug, title: `${MARK} ${slug}`, columnId: column.id, position: 1, ...extra },
    })
  const entry = (title: string | null, extra: object = {}) =>
    prisma.entry.create({
      data: { owner, title, bodyJson: body, bodyText: 'Spoke at length.', ...extra },
    })

  const maya = await contact('maya', { headline: 'Infra lead' })
  const tobias = await contact('tobias')
  const draftContact = await contact('draft', { isDraft: true })
  const trashedContact = await contact('trashed', { deletedAt: new Date() })
  const apollo = await project('apollo', { status: 'ARCHIVED' })
  const draftProject = await project('draft', { isDraft: true })
  const launch = await task('launch', { projectId: apollo.id, status: 'DONE' })
  const checklist = await task('checklist', { parentTaskId: launch.id })
  const draftTask = await task('draft', { isDraft: true })
  const call = await entry(null, { kind: 'CALL', projectId: apollo.id })
  const trashedEntry = await entry('trashed', { deletedAt: new Date() })
  const work = await prisma.tag.create({ data: { owner, name: `${MARK}work` } })

  await prisma.mention.createMany({
    data: [
      { entryId: call.id, contactId: maya.id },
      { entryId: call.id, contactId: draftContact.id },
      { entryId: trashedEntry.id, contactId: tobias.id },
    ],
  })
  await prisma.entityRef.createMany({
    data: [
      { entryId: call.id, targetType: 'TASK', taskId: launch.id },
      { entryId: call.id, targetType: 'PROJECT', projectId: apollo.id },
      { entryId: call.id, targetType: 'TASK', taskId: draftTask.id },
      { entryId: call.id, targetType: 'PROJECT', projectId: draftProject.id },
    ],
  })
  await prisma.taskAssignee.createMany({
    data: [
      { taskId: launch.id, contactId: tobias.id },
      { taskId: launch.id, contactId: trashedContact.id },
    ],
  })
  await prisma.contactTag.create({ data: { contactId: maya.id, tagId: work.id } })
  await prisma.entryTag.create({ data: { entryId: call.id, tagId: work.id } })
  await prisma.taskTag.create({ data: { taskId: checklist.id, tagId: work.id } })
  await prisma.entityEdge.createMany({
    data: [
      {
        owner,
        sourceType: 'contact',
        sourceId: maya.id,
        targetType: 'contact',
        targetId: tobias.id,
        relation: 'mentors',
      },
      {
        owner,
        sourceType: 'contact',
        sourceId: tobias.id,
        targetType: 'contact',
        targetId: maya.id,
        relation: 'mentors',
      },
      {
        owner,
        sourceType: 'contact',
        sourceId: maya.id,
        targetType: 'project',
        targetId: apollo.id,
        relation: 'works on',
      },
      // Says what the Mention above says: one link, two origins.
      {
        owner,
        sourceType: 'entry',
        sourceId: call.id,
        targetType: 'contact',
        targetId: maya.id,
        relation: INFERRED.mentions,
      },
      {
        owner,
        sourceType: 'contact',
        sourceId: maya.id,
        targetType: 'contact',
        targetId: draftContact.id,
        relation: 'knows',
      },
      {
        owner,
        sourceType: 'contact',
        sourceId: maya.id,
        targetType: 'tag',
        targetId: work.id,
        relation: 'likes',
      },
      {
        owner,
        sourceType: 'contact',
        sourceId: maya.id,
        targetType: 'contact',
        targetId: 'no-such-row',
        relation: 'knows',
      },
    ],
  })
  return {
    column,
    maya,
    tobias,
    draftContact,
    trashedContact,
    apollo,
    draftProject,
    launch,
    checklist,
    draftTask,
    call,
    trashedEntry,
    work,
  }
}

type World = Awaited<ReturnType<typeof world>>
let a: World
let b: World
/** A's task whose parent is B's: a node, but with no subtask link. */
let orphan: { id: string }

beforeAll(async () => {
  a = await world(A)
  b = await world(B)

  // Rows joining the two owners, which the app never writes but the schema allows.
  await prisma.mention.create({ data: { entryId: a.call.id, contactId: b.maya.id } })
  await prisma.entityRef.create({
    data: { entryId: a.call.id, targetType: 'TASK', taskId: b.launch.id },
  })
  await prisma.taskAssignee.create({ data: { taskId: a.launch.id, contactId: b.maya.id } })
  await prisma.contactTag.create({ data: { contactId: a.maya.id, tagId: b.work.id } })
  await prisma.entryTag.create({ data: { entryId: a.call.id, tagId: b.work.id } })
  await prisma.taskTag.create({ data: { taskId: a.launch.id, tagId: b.work.id } })
  await prisma.task.update({ where: { id: a.checklist.id }, data: { projectId: b.apollo.id } })
  orphan = await prisma.task.create({
    data: {
      owner: A,
      slug: 'child-of-b',
      title: `${MARK} child of b`,
      columnId: a.column.id,
      position: 2,
      parentTaskId: b.launch.id,
    },
  })
  await prisma.entityEdge.create({
    data: {
      owner: A,
      sourceType: 'contact',
      sourceId: a.maya.id,
      targetType: 'contact',
      targetId: b.maya.id,
      relation: 'knows',
    },
  })
  // B's edge between A's records is not A's.
  await prisma.entityEdge.create({
    data: {
      owner: B,
      sourceType: 'contact',
      sourceId: a.maya.id,
      targetType: 'contact',
      targetId: a.tobias.id,
      relation: 'stolen',
    },
  })
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
  }
  await prisma.$disconnect()
})

type Graph = Awaited<ReturnType<typeof getGraph>>

/** The graph with database ids swapped for the names `world` gave them, for readable expectations. */
function named(w: World, graph: Graph) {
  const name = new Map<string, string>([[orphan.id, 'orphan']])
  for (const [key, row] of Object.entries(w)) name.set(row.id, key)
  const label = (id: string) => {
    const colon = id.indexOf(':')
    const entityId = id.slice(colon + 1)
    return `${id.slice(0, colon)}:${name.get(entityId) ?? `?${entityId}`}`
  }
  return {
    nodes: graph.nodes.map((n) => label(n.id)),
    links: graph.links
      .map((l) => `${label(l.source)} -${l.relation}-> ${label(l.target)} [${l.origins.join(',')}]`)
      .sort(),
  }
}

const VISIBLE = [
  'contact:maya',
  'contact:tobias',
  'entry:call',
  'project:apollo',
  'tag:work',
  'task:checklist',
  'task:launch',
  'task:orphan',
]

describe('the whole graph', () => {
  it("holds exactly the owner's visible records, completed and archived work included", async () => {
    const graph = await getGraph(A, whole)
    expect(named(a, graph).nodes.sort()).toEqual(VISIBLE)
    expect(graph.nodes.find((n) => n.entityId === a.launch.id)?.subtitle).toBe('Done')
    expect(graph.nodes.find((n) => n.entityId === a.apollo.id)?.subtitle).toBe('Archived')
    expect(graph.nodes.find((n) => n.entityId === a.call.id)).toMatchObject({
      name: 'Untitled call',
      description: 'Spoke at length.',
      url: `/notes/${a.call.id}`,
    })
    expect(graph.nodes.find((n) => n.entityId === a.maya.id)).toMatchObject({
      subtitle: 'Infra lead',
      url: '/contacts/maya',
    })
  })

  it('links every relationship source, and nothing to hidden, missing or foreign records', async () => {
    expect(named(a, await getGraph(A, whole)).links).toEqual(
      [
        'contact:maya -mentors-> contact:tobias [EntityEdge]',
        'contact:tobias -mentors-> contact:maya [EntityEdge]',
        'contact:maya -works on-> project:apollo [EntityEdge]',
        `contact:maya -${INFERRED.tagged}-> tag:work [ContactTag]`,
        `entry:call -${INFERRED.mentions}-> contact:maya [EntityEdge,Mention]`,
        `entry:call -${INFERRED.references}-> task:launch [EntityRef]`,
        `entry:call -${INFERRED.references}-> project:apollo [EntityRef]`,
        `entry:call -${INFERRED.inProject}-> project:apollo [Entry.projectId]`,
        `entry:call -${INFERRED.tagged}-> tag:work [EntryTag]`,
        `task:launch -${INFERRED.assignedTo}-> contact:tobias [TaskAssignee]`,
        `task:launch -${INFERRED.inProject}-> project:apollo [Task.projectId]`,
        `task:launch -${INFERRED.subtask}-> task:checklist [Task.parentTaskId]`,
        `task:checklist -${INFERRED.tagged}-> tag:work [TaskTag]`,
      ].sort(),
    )
  })

  it("never names the other owner's records, though they share names and slugs", async () => {
    const graph = await getGraph(A, whole)
    const text = JSON.stringify(graph)
    for (const row of Object.values(b)) expect(text).not.toContain(row.id)
    expect(text).not.toContain('stolen')
    expect(text).not.toContain(B)
    expect(text).not.toContain('"owner"')

    // B sees its own world, untouched by A's foreign rows.
    const theirs = await getGraph(B, whole)
    const { nodes } = named(b, theirs)
    expect(nodes.sort()).toEqual(VISIBLE.filter((n) => n !== 'task:orphan'))
    for (const row of Object.values(a)) expect(JSON.stringify(theirs)).not.toContain(row.id)
  })

  it('only links nodes it holds, and gives the same answer every time', async () => {
    const graph = await getGraph(A, whole)
    const ids = new Set(graph.nodes.map((n) => n.id))
    for (const l of graph.links) {
      expect(ids.has(l.source) && ids.has(l.target), l.id).toBe(true)
    }
    expect(await getGraph(A, whole)).toEqual(graph)
  })
})

describe('a focused graph', () => {
  it('is one step either way at depth 1', async () => {
    const graph = await getGraph(A, focus(`task:${a.checklist.id}`, 1))
    expect(named(a, graph).nodes.sort()).toEqual(['tag:work', 'task:checklist', 'task:launch'])
    expect(named(a, graph).links).toEqual(
      [
        `task:launch -${INFERRED.subtask}-> task:checklist [Task.parentTaskId]`,
        `task:checklist -${INFERRED.tagged}-> tag:work [TaskTag]`,
      ].sort(),
    )
  })

  it('reaches two steps by default', async () => {
    const graph = await getGraph(A, focus(`contact:${a.tobias.id}`))
    expect(named(a, graph).nodes.sort()).toEqual([
      'contact:maya',
      'contact:tobias',
      'entry:call',
      'project:apollo',
      'tag:work',
      'task:checklist',
      'task:launch',
    ])
  })

  it('answers the same 404 for a draft, a trashed, a missing or a foreign focus', async () => {
    for (const id of [
      `contact:${a.draftContact.id}`,
      `contact:${a.trashedContact.id}`,
      `entry:${a.trashedEntry.id}`,
      `task:${a.draftTask.id}`,
      `project:${a.draftProject.id}`,
      'contact:no-such-row',
      `contact:${b.maya.id}`,
      `tag:${b.work.id}`,
      // The right id under the wrong type.
      `task:${a.maya.id}`,
    ]) {
      await expect(getGraph(A, focus(id)), id).rejects.toThrow(NotFoundError)
    }
  })
})
