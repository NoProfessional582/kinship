import type { UpsertContactInput, UpsertProjectInput, UpsertTaskInput } from '../validation'
import type { getContact } from '../services/contacts'
import type { getProject } from '../services/projects'
import type { getTask } from '../services/tasks'

/**
 * A record as its REST save expects it back. The contact, task and project saves replace
 * the whole record, as the app's forms send it whole; an update tool takes only the fields
 * the agent wants changed, so it starts from these and lays the agent's fields over them.
 * Anything left out here would be cleared by every agent edit: `tests/mcp-current.test.ts`
 * checks each mapping covers its schema.
 */

type Found<F extends (...args: never[]) => Promise<unknown>> = NonNullable<Awaited<ReturnType<F>>>

export function contactInput(c: Found<typeof getContact>): UpsertContactInput {
  return {
    displayName: c.displayName,
    firstName: c.firstName,
    lastName: c.lastName,
    nickname: c.nickname,
    pronouns: c.pronouns,
    avatarUrl: c.avatarUrl,
    headline: c.headline,
    company: c.company,
    jobTitle: c.jobTitle,
    location: c.location,
    birthday: c.birthday,
    tier: c.tier,
    cadence: c.cadence,
    howWeMet: c.howWeMet,
    bio: c.bio,
    personalContext: c.personalContext,
    notes: c.notes,
    interests: c.interests,
    customFields: (c.customFields ?? {}) as Record<string, string>,
    tags: c.tags.map((t) => t.tag.name),
    channels: c.channels.map((ch) => ({
      type: ch.type,
      value: ch.value,
      label: ch.label,
      isPreferred: ch.isPreferred,
    })),
    positions: c.positions.map((p) => ({
      role: p.role,
      organization: p.organization,
      team: p.team,
      startDate: p.startDate,
      endDate: p.endDate,
      isCurrent: p.isCurrent,
    })),
    milestones: c.milestones.map((m) => ({ title: m.title, date: m.date, note: m.note })),
    links: c.links.map((l) => ({ label: l.label, url: l.url })),
    attributes: c.attributes.map((a) => ({ category: a.category, key: a.key, value: a.value })),
    isDraft: c.isDraft,
  }
}

export function taskInput(t: Found<typeof getTask>): UpsertTaskInput {
  return {
    title: t.title,
    description: t.description,
    priority: t.priority,
    projectId: t.projectId,
    parentTaskId: t.parentTaskId,
    columnId: t.columnId,
    startDate: t.startDate,
    dueDate: t.dueDate,
    allDay: t.allDay,
    assigneeIds: t.assignees.map((a) => a.contactId),
    tags: t.tags.map((x) => x.tag.name),
    isDraft: t.isDraft,
  }
}

export function projectInput(p: Found<typeof getProject>): UpsertProjectInput {
  return {
    name: p.name,
    description: p.description,
    color: p.color,
    status: p.status,
    startDate: p.startDate,
    targetDate: p.targetDate,
    allDay: p.allDay,
    isDraft: p.isDraft,
  }
}

/** The agent's fields over the record's: a field sent as `null` clears, one left out stays. */
export function overlay<T extends object>(current: T, changes: Record<string, unknown>): T {
  const sent = Object.entries(changes).filter(([, v]) => v !== undefined)
  return { ...current, ...Object.fromEntries(sent) }
}
