import type { z } from 'zod'
import type { GraphData } from '../graph/constants'
import type * as R from '../openapi/responses'

/**
 * What the read tools answer: each service answer (after JSON) cut down to what an agent
 * needs: ids to follow up with, names, dates, text. Owners, slugs, avatars, colours,
 * positions, TipTap JSON and search text stay behind; fields with no value are left out.
 */

type Out<S extends z.ZodType> = z.output<S>

/** Drops null, undefined, '' and empty arrays and objects, all the way down. */
export function compact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(compact) as T
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value)) {
    const v = compact(raw)
    if (v === null || v === undefined || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue
    out[key] = v
  }
  return out as T
}

/** A page of a list the service answers whole: the slice, and where the next one starts. */
export function page<T>(items: T[], limit: number, offset: number) {
  const slice = items.slice(offset, offset + limit)
  const next = offset + slice.length
  return { total: items.length, items: slice, ...(next < items.length ? { nextOffset: next } : {}) }
}

/** Search snippets wrap matches in `<mark>`; an agent wants the words. */
export function plainSnippet(snippet: string | null | undefined): string | null {
  return snippet ? snippet.replace(/<\/?mark>/g, '') : null
}

const project = (p: { id: string; name: string } | null | undefined) =>
  p ? { id: p.id, name: p.name } : null

// ---------------------------------------------------------------- Entries

type EntryLike = Out<typeof R.EntryRow> &
  Partial<
    Pick<
      Out<typeof R.EntryWithFollowUps>,
      'mentions' | 'refs' | 'tags' | 'project' | 'followUp' | 'followsUp'
    >
  >

type FollowUp = Out<typeof R.FollowUpLink> | null | undefined

const followUp = (f: FollowUp) =>
  f
    ? { id: f.id, kind: f.kind, title: f.title, occurredAt: f.occurredAt, written: f.written }
    : null

/** A saved note, and the draft records its `new` mentions created. */
export function savedEntry(s: Out<typeof R.EntrySaved>) {
  return compact({ entry: entry(s.entry), created: s.createdEntities })
}

export function entry(e: EntryLike) {
  return compact({
    id: e.id,
    kind: e.kind,
    title: e.title,
    occurredAt: e.occurredAt,
    direction: e.direction,
    durationMin: e.durationMin,
    location: e.location,
    body: e.body,
    project: project(e.project),
    people: e.mentions?.map((m) => ({ id: m.contact.id, name: m.contact.displayName })),
    tasks: e.refs?.flatMap((r) =>
      r.task ? [{ id: r.task.id, title: r.task.title, status: r.task.status }] : [],
    ),
    projects: e.refs?.flatMap((r) => (r.project ? [project(r.project)] : [])),
    tags: e.tags?.map((t) => t.tag.name),
    followUp: followUp(e.followUp),
    followsUp: followUp(e.followsUp),
  })
}

// --------------------------------------------------------------- Contacts

export function contactSummary(c: Out<typeof R.ContactSummary>) {
  return compact({
    id: c.id,
    displayName: c.displayName,
    headline: c.headline,
    company: c.company,
    jobTitle: c.jobTitle,
    location: c.location,
    tier: c.tier,
    cadence: c.cadence,
    birthday: c.birthday,
    lastContactAt: c.lastContactAt,
    interactions: c._count.mentions,
    isDraft: c.isDraft || null,
  })
}

/** How many of a contact's entries `get_contact` shows; `get_entries` pages the rest. */
export const DOSSIER_ENTRIES = 20

/** A contact's whole record, as get_contact and the contact write tools answer it. */
export function contact(c: Out<typeof R.ContactDetail>) {
  return compact({
    id: c.id,
    displayName: c.displayName,
    firstName: c.firstName,
    lastName: c.lastName,
    nickname: c.nickname,
    pronouns: c.pronouns,
    headline: c.headline,
    company: c.company,
    jobTitle: c.jobTitle,
    location: c.location,
    birthday: c.birthday,
    howWeMet: c.howWeMet,
    bio: c.bio,
    personalContext: c.personalContext,
    notes: c.notes,
    interests: c.interests,
    customFields: c.customFields,
    tier: c.tier,
    cadence: c.cadence,
    lastContactAt: c.lastContactAt,
    isDraft: c.isDraft || null,
    interactions: c._count.mentions,
    tags: c.tags.map((t) => t.tag.name),
    channels: c.channels.map((ch) => ({
      type: ch.type,
      value: ch.value,
      label: ch.label,
      isPreferred: ch.isPreferred || null,
    })),
    positions: c.positions.map((p) => ({
      role: p.role,
      organization: p.organization,
      team: p.team,
      startDate: p.startDate,
      endDate: p.endDate,
      isCurrent: p.isCurrent || null,
    })),
    milestones: c.milestones.map((m) => ({ title: m.title, date: m.date, note: m.note })),
    links: c.links.map((l) => ({ label: l.label, url: l.url })),
    attributes: c.attributes.map((a) => ({ category: a.category, key: a.key, value: a.value })),
  })
}

export function contactDossier(d: Out<typeof R.ContactDossier>) {
  return compact({
    contact: contact(d.contact),
    entries: d.entries.slice(0, DOSSIER_ENTRIES).map(entry),
    moreEntries: d.entries.length > DOSSIER_ENTRIES || null,
    upcoming: d.upcoming.map((u) => ({
      id: u.id,
      kind: u.kind,
      title: u.title,
      occurredAt: u.occurredAt,
      project: project(u.project),
      followUp: u.isFollowUp || null,
      openLoop: u.openLoop || null,
    })),
    tasks: d.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      project: project(t.project),
    })),
    projects: d.projects.map((p) => ({ id: p.id, name: p.name, status: p.status })),
  })
}

export function dueContact(c: Out<typeof R.CadenceContact>) {
  return compact({
    id: c.id,
    displayName: c.displayName,
    cadence: c.cadence,
    tier: c.tier,
    lastContactAt: c.lastContactAt,
    state: c.health.state,
    daysSince: c.health.daysSince,
    dueInDays: c.health.dueInDays,
  })
}

// ---------------------------------------------------------- Tasks & board

const column = (c: { id: string; name: string }) => ({ id: c.id, name: c.name })

export function task(t: Out<typeof R.TaskDetail> & Partial<Out<typeof R.TaskWithParent>>) {
  return compact({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    startDate: t.startDate,
    dueDate: t.dueDate,
    allDay: t.allDay,
    completedAt: t.completedAt,
    isDraft: t.isDraft || null,
    column: column(t.column),
    project: project(t.project),
    parent: t.parent ? { id: t.parent.id, title: t.parent.title } : null,
    assignees: t.assignees.map((a) => ({
      id: a.contact.id,
      name: a.contact.displayName,
      role: a.role,
    })),
    tags: t.tags.map((x) => x.tag.name),
    subtasks: t.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      priority: s.priority,
      dueDate: s.dueDate,
    })),
  })
}

export function boardColumn(c: Out<typeof R.BoardColumn>) {
  return compact({ id: c.id, name: c.name, status: c.status, wipLimit: c.wipLimit })
}

// --------------------------------------------------------------- Projects

export function projectSummary(p: Out<typeof R.ProjectSummary>) {
  return compact({
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    startDate: p.startDate,
    targetDate: p.targetDate,
    isDraft: p.isDraft || null,
    tasks: { total: p.taskTotal, done: p.doneCount, byStatus: p.taskCounts },
    people: p.people.map((c) => ({ id: c.id, name: c.displayName })),
  })
}

/** A project as a write answers it: the project alone, no tasks. */
export function projectRow(p: Out<typeof R.ProjectRow>) {
  return compact({
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    startDate: p.startDate,
    targetDate: p.targetDate,
    allDay: p.allDay,
    isDraft: p.isDraft || null,
  })
}

export function projectDetail(p: Out<typeof R.ProjectDetail>) {
  return compact({
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    startDate: p.startDate,
    targetDate: p.targetDate,
    allDay: p.allDay,
    isDraft: p.isDraft || null,
    columns: p.columns.map(boardColumn),
    tasks: p.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      column: column(t.column),
      parentTaskId: t.parentTaskId,
      assignees: t.assignees.map((a) => ({ id: a.contact.id, name: a.contact.displayName })),
    })),
  })
}

// ------------------------------------------------- Search, calendar, graph

export function searchHit(h: Out<typeof R.SearchHit>) {
  return compact({ id: h.id, kind: h.kind, title: h.title, snippet: plainSnippet(h.snippet) })
}

export function calendarEvent(e: Out<typeof R.CalendarEvent>) {
  return compact({
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    source: e.source,
    category: e.category,
    id: e.entityId,
  })
}

export function edge(e: Out<typeof R.EntityEdge>) {
  return compact({
    edgeId: e.id,
    source: { type: e.sourceType, id: e.sourceId },
    target: { type: e.targetType, id: e.targetId },
    relation: e.relation,
    note: e.note,
    weight: e.weight,
  })
}

export function relationship(e: Out<typeof R.EdgeView>) {
  return compact({
    edgeId: e.id,
    relation: e.relation,
    note: e.note,
    direction: e.direction,
    other: { type: e.otherType, id: e.otherId, name: e.label },
  })
}

export function neighbourhood(g: GraphData) {
  return {
    nodes: g.nodes.map((n) =>
      compact({
        id: n.id,
        type: n.type,
        name: n.name,
        subtitle: n.subtitle,
        description: n.description,
      }),
    ),
    links: g.links.map((l) => ({ source: l.source, target: l.target, relation: l.relation })),
  }
}
