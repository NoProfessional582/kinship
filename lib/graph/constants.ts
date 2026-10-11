/**
 * The graph's vocabulary: node types, their colours, and the names of the links
 * inferred from tables other than EntityEdge. Free of any Prisma or node import, so
 * the map's browser components can share it.
 */
import type { components } from './api.generated'

export type GraphNode = components['schemas']['GraphNode']
export type GraphLink = components['schemas']['GraphLink']
export type GraphData = components['schemas']['GraphDataResponse']
export type GraphNodeType = components['schemas']['GraphNodeType']

export const GRAPH_NODE_TYPES = [
  'contact',
  'project',
  'entry',
  'task',
  'tag',
] as const satisfies readonly GraphNodeType[]

/** The approved Cosmic Nexus colour for each type. */
export const GRAPH_COLORS: Record<GraphNodeType, string> = {
  contact: '#3b82f6',
  project: '#8b5cf6',
  entry: '#ec4899',
  task: '#f59e0b',
  tag: '#10b981',
}

/** One record's type, as the inspector's chip names it. */
export const TYPE_NAMES: Record<GraphNodeType, string> = {
  contact: 'Contact',
  project: 'Project',
  entry: 'Note',
  task: 'Task',
  tag: 'Tag',
}

/** The map's deep-space backdrop, shared by the scene and the page around it. */
export const MAP_BACKGROUND = '#080a0e'

/**
 * Relations of the links that no EntityEdge stores. A saved edge keeps its own
 * relation (lib/relations.ts names the built-in ones), so these are chosen not to
 * read like anything a person would type as a relationship.
 */
export const INFERRED = {
  /** entry → contact: the entry @mentions the person */
  mentions: 'mentions',
  /** entry → task or project: the entry [[references]] it */
  references: 'references',
  /** task → contact */
  assignedTo: 'assigned to',
  /** contact, entry or task → tag */
  tagged: 'tagged',
  /** entry or task → project: its home project */
  inProject: 'in project',
  /** parent task → subtask */
  subtask: 'subtask',
} as const

/** Which table each link came from; a merged link lists every one. */
export const ORIGINS = {
  edge: 'EntityEdge',
  mention: 'Mention',
  ref: 'EntityRef',
  assignee: 'TaskAssignee',
  contactTag: 'ContactTag',
  entryTag: 'EntryTag',
  taskTag: 'TaskTag',
  entryProject: 'Entry.projectId',
  taskProject: 'Task.projectId',
  taskParent: 'Task.parentTaskId',
} as const

/** The longest a node's description gets, in characters. */
export const DESCRIPTION_MAX = 160

/** The depths a focused graph allows, and the one it gets when none is given. */
export const FOCUS_DEPTHS = [1, 2] as const
export const DEFAULT_FOCUS_DEPTH = 2
