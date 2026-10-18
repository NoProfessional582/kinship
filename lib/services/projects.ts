import { prisma } from '../db'
import { uniqueSlug } from '../slug'
import type { UpsertProjectInput } from '../validation'
import { softDelete } from './trash'

const EMPTY_COUNTS = { TODO: 0, IN_PROGRESS: 0, BLOCKED: 0, DONE: 0, ARCHIVED: 0 }

/**
 * The projects page needs more than a total: how the work is distributed across states,
 * and who is actually on it. Both are derived from one pass over the project's
 * tasks rather than a count query per column, because a personal knowledge base
 * has tens of tasks per project, not thousands.
 */
export async function listProjects(owner: string) {
  const projects = await prisma.project.findMany({
    where: { owner, deletedAt: null },
    include: {
      tasks: {
        where: { deletedAt: null },
        select: {
          id: true,
          status: true,
          assignees: {
            select: {
              contact: { select: { id: true, slug: true, displayName: true } },
            },
          },
        },
      },
    },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
  })

  return projects.map(({ tasks, ...project }) => {
    const counts = { ...EMPTY_COUNTS }
    const people = new Map<string, (typeof tasks)[number]['assignees'][number]['contact']>()

    for (const task of tasks) {
      counts[task.status] += 1
      for (const a of task.assignees) people.set(a.contact.id, a.contact)
    }

    return {
      ...project,
      taskCounts: counts,
      taskTotal: tasks.length,
      doneCount: counts.DONE,
      people: [...people.values()],
    }
  })
}

export async function getProject(owner: string, idOrSlug: string) {
  return prisma.project.findFirst({
    where: { owner, AND: [{ deletedAt: null }, { OR: [{ id: idOrSlug }, { slug: idOrSlug }] }] },
    include: {
      tasks: {
        where: { deletedAt: null },
        include: {
          assignees: {
            include: { contact: { select: { id: true, displayName: true } } },
          },
          column: true,
        },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      },
      columns: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
    },
  })
}

export async function createProject(owner: string, input: UpsertProjectInput) {
  return prisma.$transaction(async (tx) => {
    const slug = await uniqueSlug('project', owner, input.name, tx)
    return tx.project.create({
      data: {
        owner,
        slug,
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? null,
        status: input.status,
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        allDay: input.allDay,
        isDraft: input.isDraft ?? false,
      },
    })
  })
}

export async function updateProject(owner: string, id: string, input: UpsertProjectInput) {
  await prisma.project.findFirstOrThrow({ where: { id, owner }, select: { id: true } })
  return prisma.project.update({
    where: { id },
    data: {
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? null,
      status: input.status,
      startDate: input.startDate ?? null,
      targetDate: input.targetDate ?? null,
      allDay: input.allDay,
      isDraft: input.isDraft ?? false,
    },
  })
}

/** Soft delete — recoverable from the trash. */
export async function deleteProject(owner: string, id: string) {
  return softDelete(owner, 'project', id)
}
