/**
 * Turns the rows lib/services/graph.ts reads into the graph the API sends. Pure: no
 * Prisma, no database, so every rule about what reaches the map is unit-tested here
 * (tests/graph.test.ts).
 *
 * The rows are expected to be the owner's visible records already, but nothing is
 * taken on trust: a link is kept only when both its ends are among the nodes, so a
 * join row pointing at a draft, a trashed record or another owner's record is
 * dropped rather than drawn to nowhere.
 */
import {
  DESCRIPTION_MAX,
  GRAPH_COLORS,
  INFERRED,
  ORIGINS,
  type GraphData,
  type GraphLink,
  type GraphNode,
  type GraphNodeType,
} from './constants'

export interface GraphRows {
  contacts: {
    id: string
    slug: string
    displayName: string
    headline: string | null
    jobTitle: string | null
    company: string | null
  }[]
  projects: { id: string; slug: string; name: string; status: string; description: string | null }[]
  entries: {
    id: string
    kind: string
    title: string | null
    bodyText: string | null
    occurredAt: Date
    projectId: string | null
  }[]
  tasks: {
    id: string
    title: string
    status: string
    description: string | null
    projectId: string | null
    parentTaskId: string | null
  }[]
  tags: { id: string; name: string }[]
  edges: {
    sourceType: string
    sourceId: string
    targetType: string
    targetId: string
    relation: string
  }[]
  mentions: { entryId: string; contactId: string }[]
  refs: {
    entryId: string
    targetType: string
    taskId: string | null
    projectId: string | null
  }[]
  assignees: { taskId: string; contactId: string }[]
  contactTags: { contactId: string; tagId: string }[]
  entryTags: { entryId: string; tagId: string }[]
  taskTags: { taskId: string; tagId: string }[]
}

/** The graph id of a record: its type and database id, so ids never collide across types. */
export const graphId = (type: GraphNodeType, entityId: string) => `${type}:${entityId}`

/** A link's identity: the directed ends and the relation, each encoded so none can blur into the next. */
export const linkId = (source: string, target: string, relation: string) =>
  [source, target, relation].map(encodeURIComponent).join('|')

const STATUS: Record<string, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  BLOCKED: 'Blocked',
  DONE: 'Done',
  ARCHIVED: 'Archived',
}

const KIND: Record<string, string> = {
  NOTE: 'Note',
  CALL: 'Call',
  EMAIL: 'Email',
  TEXT: 'Text',
  MEETING: 'Meeting',
  IN_PERSON: 'In person',
  SOCIAL: 'Social',
  EVENT: 'Event',
}

/** The edge endpoint types EntityEdge can name; anything else in a row is dropped. */
const EDGE_TYPES = new Set<string>(['contact', 'project', 'entry', 'task'])

/** Plain text cut to DESCRIPTION_MAX characters at most, whitespace collapsed; undefined when empty. */
export function excerpt(text: string | null | undefined): string | undefined {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!flat) return undefined
  const chars = Array.from(flat)
  if (chars.length <= DESCRIPTION_MAX) return flat
  return `${chars
    .slice(0, DESCRIPTION_MAX - 1)
    .join('')
    .trimEnd()}…`
}

/** An entry's name: its title, or "Untitled call", "Untitled note" and so on. */
export function entryName(title: string | null, kind: string) {
  const trimmed = title?.trim()
  if (trimmed) return trimmed
  return `Untitled ${(KIND[kind] ?? 'entry').toLowerCase()}`
}

const optional = <K extends string>(key: K, value: string | null | undefined) =>
  value ? ({ [key]: value } as Record<K, string>) : {}

function node(
  type: GraphNodeType,
  entityId: string,
  name: string,
  url: string | null,
  extra: { subtitle?: string | null; description?: string | null } = {},
): GraphNode {
  return {
    id: graphId(type, entityId),
    entityId,
    type,
    name,
    ...optional('subtitle', extra.subtitle),
    ...optional('description', extra.description),
    color: GRAPH_COLORS[type],
    url,
  }
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export function normalizeGraph(rows: GraphRows): GraphData {
  const nodes: GraphNode[] = [
    ...rows.contacts.map((c) =>
      node('contact', c.id, c.displayName, `/contacts/${encodeURIComponent(c.slug)}`, {
        subtitle: c.headline?.trim() || [c.jobTitle, c.company].filter(Boolean).join(' · '),
      }),
    ),
    ...rows.projects.map((p) =>
      node('project', p.id, p.name, `/projects/${encodeURIComponent(p.slug)}`, {
        subtitle: STATUS[p.status],
        description: excerpt(p.description),
      }),
    ),
    ...rows.entries.map((e) =>
      node('entry', e.id, entryName(e.title, e.kind), `/notes/${encodeURIComponent(e.id)}`, {
        subtitle: `${KIND[e.kind] ?? 'Entry'} · ${e.occurredAt.toISOString().slice(0, 10)}`,
        description: excerpt(e.bodyText),
      }),
    ),
    ...rows.tasks.map((t) =>
      node('task', t.id, t.title, `/board?task=${encodeURIComponent(t.id)}`, {
        subtitle: STATUS[t.status],
        description: excerpt(t.description),
      }),
    ),
    ...rows.tags.map((t) => node('tag', t.id, t.name, null)),
  ]
  nodes.sort(byId)
  const visible = new Set(nodes.map((n) => n.id))

  const links = new Map<string, { link: GraphLink; origins: Set<string> }>()
  const link = (source: string, target: string, relation: string, origin: string) => {
    if (source === target || !visible.has(source) || !visible.has(target)) return
    const id = linkId(source, target, relation)
    const known = links.get(id)
    if (known) known.origins.add(origin)
    else
      links.set(id, {
        link: { id, source, target, relation, origins: [] },
        origins: new Set([origin]),
      })
  }

  for (const e of rows.edges) {
    if (!EDGE_TYPES.has(e.sourceType) || !EDGE_TYPES.has(e.targetType) || !e.relation) continue
    link(
      graphId(e.sourceType as GraphNodeType, e.sourceId),
      graphId(e.targetType as GraphNodeType, e.targetId),
      e.relation,
      ORIGINS.edge,
    )
  }
  for (const m of rows.mentions) {
    link(
      graphId('entry', m.entryId),
      graphId('contact', m.contactId),
      INFERRED.mentions,
      ORIGINS.mention,
    )
  }
  for (const r of rows.refs) {
    const target =
      r.targetType === 'TASK' && r.taskId
        ? graphId('task', r.taskId)
        : r.targetType === 'PROJECT' && r.projectId
          ? graphId('project', r.projectId)
          : null
    if (target) link(graphId('entry', r.entryId), target, INFERRED.references, ORIGINS.ref)
  }
  for (const a of rows.assignees) {
    link(
      graphId('task', a.taskId),
      graphId('contact', a.contactId),
      INFERRED.assignedTo,
      ORIGINS.assignee,
    )
  }
  for (const t of rows.contactTags) {
    link(
      graphId('contact', t.contactId),
      graphId('tag', t.tagId),
      INFERRED.tagged,
      ORIGINS.contactTag,
    )
  }
  for (const t of rows.entryTags) {
    link(graphId('entry', t.entryId), graphId('tag', t.tagId), INFERRED.tagged, ORIGINS.entryTag)
  }
  for (const t of rows.taskTags) {
    link(graphId('task', t.taskId), graphId('tag', t.tagId), INFERRED.tagged, ORIGINS.taskTag)
  }
  for (const e of rows.entries) {
    if (e.projectId) {
      link(
        graphId('entry', e.id),
        graphId('project', e.projectId),
        INFERRED.inProject,
        ORIGINS.entryProject,
      )
    }
  }
  for (const t of rows.tasks) {
    if (t.projectId) {
      link(
        graphId('task', t.id),
        graphId('project', t.projectId),
        INFERRED.inProject,
        ORIGINS.taskProject,
      )
    }
    if (t.parentTaskId) {
      link(
        graphId('task', t.parentTaskId),
        graphId('task', t.id),
        INFERRED.subtask,
        ORIGINS.taskParent,
      )
    }
  }

  return {
    nodes,
    links: [...links.values()]
      .map(({ link, origins }) => ({ ...link, origins: [...origins].sort() }))
      .sort(byId),
  }
}
