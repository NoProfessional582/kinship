import { prisma } from '../db'
import { focusGraph, type GraphQuery } from '../graph/focus'
import { normalizeGraph, type GraphRows } from '../graph/normalize'
import type { GraphData } from '../graph/constants'

/**
 * The 3D map's data: every visible record of the owner and every relationship between
 * them, read in one snapshot so a link never points at a record the same answer left
 * out. Visible means the owner's, not in the trash and not a draft (entries have no
 * drafts; tags have neither); completed and archived work stays, since it is still
 * a record, not trash.
 *
 * One query per table, whatever the size of the graph, each reading only the columns
 * the map shows. Join rows are filtered through both of their records, and
 * normalizeGraph drops any link whose ends are not both nodes all the same.
 */
export async function getGraph(owner: string, query: GraphQuery): Promise<GraphData> {
  const rows = await readGraphRows(owner)
  const graph = normalizeGraph(rows)
  return query.focus ? focusGraph(graph, query.focus.id, query.depth ?? 2) : graph
}

async function readGraphRows(owner: string): Promise<GraphRows> {
  const contact = { owner, deletedAt: null, isDraft: false }
  const project = { owner, deletedAt: null, isDraft: false }
  const task = { owner, deletedAt: null, isDraft: false }
  const entry = { owner, deletedAt: null }
  const tag = { owner }

  // Repeatable read: every query below sees the database as it was at the first one.
  return prisma.$transaction(
    async (tx) => {
      const contacts = await tx.contact.findMany({
        where: contact,
        select: {
          id: true,
          slug: true,
          displayName: true,
          headline: true,
          jobTitle: true,
          company: true,
        },
      })
      const projects = await tx.project.findMany({
        where: project,
        select: { id: true, slug: true, name: true, status: true, description: true },
      })
      const entries = await tx.entry.findMany({
        where: entry,
        select: {
          id: true,
          kind: true,
          title: true,
          bodyText: true,
          occurredAt: true,
          projectId: true,
        },
      })
      const tasks = await tx.task.findMany({
        where: task,
        select: {
          id: true,
          title: true,
          status: true,
          description: true,
          projectId: true,
          parentTaskId: true,
        },
      })
      const tags = await tx.tag.findMany({ where: tag, select: { id: true, name: true } })
      const edges = await tx.entityEdge.findMany({
        where: { owner },
        select: {
          sourceType: true,
          sourceId: true,
          targetType: true,
          targetId: true,
          relation: true,
        },
      })
      const mentions = await tx.mention.findMany({
        where: { entry, contact },
        select: { entryId: true, contactId: true },
      })
      const refs = await tx.entityRef.findMany({
        where: {
          entry,
          OR: [
            { targetType: 'TASK', task },
            { targetType: 'PROJECT', project },
          ],
        },
        select: { entryId: true, targetType: true, taskId: true, projectId: true },
      })
      const assignees = await tx.taskAssignee.findMany({
        where: { task, contact },
        select: { taskId: true, contactId: true },
      })
      const contactTags = await tx.contactTag.findMany({
        where: { contact, tag },
        select: { contactId: true, tagId: true },
      })
      const entryTags = await tx.entryTag.findMany({
        where: { entry, tag },
        select: { entryId: true, tagId: true },
      })
      const taskTags = await tx.taskTag.findMany({
        where: { task, tag },
        select: { taskId: true, tagId: true },
      })
      return {
        contacts,
        projects,
        entries,
        tasks,
        tags,
        edges,
        mentions,
        refs,
        assignees,
        contactTags,
        entryTags,
        taskTags,
      }
    },
    { isolationLevel: 'RepeatableRead', timeout: 30_000, maxWait: 10_000 },
  )
}
