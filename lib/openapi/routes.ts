import { z } from 'zod'
import {
  attributesSchema,
  calendarQuerySchema,
  createEntrySchema,
  edgeListSchema,
  edgeSchema,
  entryListSchema,
  mentionSearchSchema,
  moveTaskSchema,
  reorderColumnsSchema,
  rescheduleSchema,
  settingsSchema,
  trashActionSchema,
  updateEntrySchema,
  upsertColumnSchema,
  upsertContactSchema,
  upsertProjectSchema,
  upsertTaskSchema,
} from '../validation'
import * as R from './responses'

/**
 * Every API route, with the schemas it reads and answers. scripts/api-spec.ts
 * turns this table into docs/api/kinship.openapi.json, and
 * tests/openapi-coverage.test.ts fails when a `route.ts` method is missing from
 * it (or the table names one that does not exist).
 *
 * Request schemas are the ones the routes parse. Query schemas the routes build
 * by hand are written out here, for the spec alone.
 */

export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'

/**
 * Statuses a route can give besides 200. 403 and 500 apply to every route; 400 (the body
 * is not JSON) and 415 to every JSON body.
 */
export type ErrorStatus = 400 | 404 | 405 | 409 | 413 | 415 | 500 | 503

/** Raw OpenAPI content, for answers and bodies that are not JSON. */
export type Content = Record<string, { schema: Record<string, unknown> }>

export interface ApiRoute {
  method: Method
  /** OpenAPI form: `/api/contacts/{id}`. */
  path: string
  operationId: string
  tag: string
  summary: string
  description?: string
  /** Descriptions of the path parameters, by name. */
  params?: Record<string, string>
  query?: z.ZodObject
  /** A JSON body. */
  body?: z.ZodType
  /** A body that is not JSON. */
  bodyContent?: Content
  /** The 200 answer, as JSON. A route with neither this nor `responseContent` never answers 200. */
  response?: z.ZodType
  /** The 200 answer when it is not plain JSON. */
  responseContent?: Content
  responseHeaders?: Record<string, string>
  /** Why each extra status happens. */
  errors?: Partial<Record<ErrorStatus, string>>
  /** Taken from docs/api/graph.openapi.json instead of described here. */
  external?: 'graph'
}

/** Request bodies with a name in the spec. Response names come from responses.ts. */
export const requestSchemas = {
  UpsertContact: upsertContactSchema,
  ContactAttributes: attributesSchema,
  CreateEntry: createEntrySchema,
  UpdateEntry: updateEntrySchema,
  UpsertTask: upsertTaskSchema,
  MoveTask: moveTaskSchema,
  UpsertProject: upsertProjectSchema,
  UpsertColumn: upsertColumnSchema,
  UpdateColumn: upsertColumnSchema.partial(),
  ReorderColumns: reorderColumnsSchema,
  Edge: edgeSchema,
  TrashAction: trashActionSchema,
  Reschedule: rescheduleSchema,
  SettingsPatch: settingsSchema,
  ArchiveImport: z
    .object({
      format: z.literal('kb-archive'),
      version: z.number().int().positive(),
      exportedAt: z.string().optional(),
      migrations: z.array(z.string()).default([]),
      data: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
    })
    .meta({ description: 'An archive from `GET /api/export`, sent back unchanged.' }),
} as const

const ID = 'The record id.'
const ID_OR_SLUG = 'The record id or its slug.'
const NOT_FOUND = 'No such record for this owner, or it is in the trash.'
const BAD_BODY = 'The body failed validation.'

/** An MCP message: JSON-RPC 2.0, described by the protocol rather than here. */
const mcpContent = (description: string): Content => ({
  'application/json': {
    schema: {
      description,
      oneOf: [{ type: 'object' }, { type: 'array', items: { type: 'object' } }],
    },
  },
})

export const routes: ApiRoute[] = [
  // ---------------------------------------------------------------- Health
  {
    method: 'get',
    path: '/api/health',
    operationId: 'getHealth',
    tag: 'System',
    summary: 'Whether the server and its database answer',
    response: R.Health,
    errors: { 503: 'The database is unreachable; the body is `{ "ok": false }`.' },
  },
  {
    method: 'get',
    path: '/api/openapi.json',
    operationId: 'getApiSpec',
    tag: 'System',
    summary: 'This description of the API (OpenAPI 3.1)',
    description: 'The same document as docs/api/kinship.openapi.json in the repo.',
    response: z.record(z.string(), z.unknown()).meta({ description: 'An OpenAPI 3.1 document.' }),
  },

  // -------------------------------------------------------------- Contacts
  {
    method: 'get',
    path: '/api/contacts',
    operationId: 'listContacts',
    tag: 'Contacts',
    summary: 'List contacts, A to Z',
    query: z.object({
      q: z
        .string()
        .optional()
        .meta({ description: 'Part of a name, company, job title, headline or nickname.' }),
      drafts: z.literal('1').optional().meta({ description: 'Only drafts (`1`).' }),
      tag: z.string().optional().meta({ description: 'Only contacts with this tag name.' }),
    }),
    response: z.array(R.ContactSummary),
  },
  {
    method: 'post',
    path: '/api/contacts',
    operationId: 'createContact',
    tag: 'Contacts',
    summary: 'Create a contact',
    body: upsertContactSchema,
    response: R.ContactDetail,
    errors: { 400: BAD_BODY },
  },
  {
    method: 'get',
    path: '/api/contacts/{id}',
    operationId: 'getContact',
    tag: 'Contacts',
    summary: 'A contact with its history, tasks, projects and upcoming items',
    params: { id: ID_OR_SLUG },
    response: R.ContactDossier,
    errors: { 404: NOT_FOUND },
  },
  {
    method: 'patch',
    path: '/api/contacts/{id}',
    operationId: 'updateContact',
    tag: 'Contacts',
    summary: 'Replace a contact',
    description:
      'Sends the whole contact, as create does: absent fields take their defaults and ' +
      'every list (channels, positions, milestones, links, tags) is replaced. Read it first. ' +
      'Clears `isDraft` unless it is sent as true.',
    params: { id: ID },
    body: upsertContactSchema,
    response: R.ContactDetail,
    errors: { 400: BAD_BODY, 404: NOT_FOUND },
  },
  {
    method: 'delete',
    path: '/api/contacts/{id}',
    operationId: 'deleteContact',
    tag: 'Contacts',
    summary: 'Move a contact to the trash',
    params: { id: ID },
    response: R.ContactRow,
    errors: { 404: 'No such contact for this owner.' },
  },
  {
    method: 'get',
    path: '/api/contacts/{id}/attributes',
    operationId: 'listContactAttributes',
    tag: 'Contacts',
    summary: "A contact's custom attributes, by category",
    params: { id: ID },
    response: z.array(R.ContactAttribute),
    errors: { 404: 'No such contact for this owner.' },
  },
  {
    method: 'put',
    path: '/api/contacts/{id}/attributes',
    operationId: 'replaceContactAttributes',
    tag: 'Contacts',
    summary: "Replace a contact's custom attributes",
    description: 'The list sent becomes the whole set. A blank category becomes `Details`.',
    params: { id: ID },
    body: attributesSchema,
    response: z.array(R.ContactAttribute),
    errors: { 400: BAD_BODY, 404: 'No such contact for this owner.' },
  },
  {
    method: 'get',
    path: '/api/cadence',
    operationId: 'listContactsDue',
    tag: 'Contacts',
    summary: 'Up to 8 contacts due or overdue for a check-in, never-contacted first',
    response: z.array(R.CadenceContact),
  },

  // --------------------------------------------------------------- Entries
  {
    method: 'get',
    path: '/api/entries',
    operationId: 'listEntries',
    tag: 'Entries',
    summary: 'List entries, newest first (nearest first with `upcoming`)',
    query: entryListSchema.extend({
      take: entryListSchema.shape.take.meta({ description: 'Page size. Defaults to 50.' }),
      skip: entryListSchema.shape.skip.meta({ description: 'Rows to skip. Defaults to 0.' }),
    }),
    response: z.array(R.EntryWithFollowUps),
    errors: { 400: 'A query parameter failed validation.' },
  },
  {
    method: 'post',
    path: '/api/entries',
    operationId: 'createEntry',
    tag: 'Entries',
    summary: 'Log an entry',
    description:
      'Send the note as `body`, plain text with mentions (`@[Jane Doe](contact:<id>)`, ' +
      '`[[Ship v2]](task:<id>)`, `[[Launch]](project:<id>)`), or as `bodyJson`, never both. ' +
      'A mention with id `new` (in `bodyJson`, a `new:` id) creates a draft record, listed in ' +
      '`createdEntities`. `followUpAt` creates a second, empty entry on that date that ' +
      'continues this one.',
    body: createEntrySchema,
    response: R.EntrySaved,
    errors: {
      400:
        BAD_BODY +
        ' Also: both `body` and `bodyJson`, or neither, or a mention of an id ' +
        "the owner doesn't have.",
    },
  },
  {
    method: 'get',
    path: '/api/entries/{id}',
    operationId: 'getEntry',
    tag: 'Entries',
    summary: 'One entry',
    params: { id: ID },
    response: R.EntryWithFollowUps,
    errors: { 404: NOT_FOUND },
  },
  {
    method: 'patch',
    path: '/api/entries/{id}',
    operationId: 'updateEntry',
    tag: 'Entries',
    summary: 'Change some of an entry',
    description:
      'Only the fields sent change. Sending `body` or `bodyJson` (not both) replaces the note ' +
      'and rewrites its mentions and refs; `followUpAt: null` withdraws an empty follow-up.',
    params: { id: ID },
    body: updateEntrySchema,
    response: R.EntrySaved,
    errors: {
      400:
        BAD_BODY +
        " Also: both `body` and `bodyJson`, or a mention of an id the owner doesn't have.",
      404: 'No such entry for this owner.',
    },
  },
  {
    method: 'delete',
    path: '/api/entries/{id}',
    operationId: 'deleteEntry',
    tag: 'Entries',
    summary: 'Move an entry to the trash',
    params: { id: ID },
    response: R.EntryRow,
    errors: { 404: 'No such entry for this owner.' },
  },

  // ----------------------------------------------------------------- Tasks
  {
    method: 'get',
    path: '/api/tasks',
    operationId: 'getBoard',
    tag: 'Tasks',
    summary: 'The board: every column and its top-level cards',
    query: z.object({
      projectId: z
        .string()
        .optional()
        .meta({ description: "Only this project's cards. The columns are the same." }),
    }),
    response: R.Board,
    errors: { 404: 'No such project for this owner.' },
  },
  {
    method: 'post',
    path: '/api/tasks',
    operationId: 'createTask',
    tag: 'Tasks',
    summary: 'Create a task',
    description:
      'Lands at the bottom of `columnId`, or of the first column. Its status is the column’s.',
    body: upsertTaskSchema,
    response: R.TaskDetail,
    errors: {
      400: BAD_BODY + ' Also: the parent would form a cycle.',
      404: 'The project, parent task, column or an assignee does not exist.',
    },
  },
  {
    method: 'get',
    path: '/api/tasks/{id}',
    operationId: 'getTask',
    tag: 'Tasks',
    summary: 'One task with its subtasks and parent',
    params: { id: ID_OR_SLUG },
    response: R.TaskWithParent,
    errors: { 404: NOT_FOUND },
  },
  {
    method: 'patch',
    path: '/api/tasks/{id}',
    operationId: 'updateTask',
    tag: 'Tasks',
    summary: 'Replace a task',
    description:
      'Sends the whole task: absent fields take their defaults and assignees and tags are ' +
      'replaced. Read it first. A new `columnId` moves the card to the bottom of that column.',
    params: { id: ID },
    body: upsertTaskSchema,
    response: R.TaskDetail,
    errors: {
      400: BAD_BODY + ' Also: the parent would form a cycle.',
      404: 'The task, project, parent task, column or an assignee does not exist.',
    },
  },
  {
    method: 'delete',
    path: '/api/tasks/{id}',
    operationId: 'deleteTask',
    tag: 'Tasks',
    summary: 'Move a task to the trash',
    params: { id: ID },
    response: R.TaskRow,
    errors: { 404: 'No such task for this owner.' },
  },
  {
    method: 'patch',
    path: '/api/tasks/{id}/move',
    operationId: 'moveTask',
    tag: 'Tasks',
    summary: 'Move a card to a column and place',
    description:
      'Name the neighbours with `beforeId` / `afterId`; `toIndex` is used only when neither ' +
      'is in the column. The card takes on the column’s status.',
    params: { id: ID },
    body: moveTaskSchema,
    response: R.TaskDetail,
    errors: { 400: BAD_BODY, 404: 'The task, column or project does not exist.' },
  },
  {
    method: 'get',
    path: '/api/drafts',
    operationId: 'listDrafts',
    tag: 'Tasks',
    summary: 'Draft contacts, tasks and projects, newest first',
    description: 'Drafts are records created inline from a note, waiting to be filled in.',
    response: R.Drafts,
  },

  // --------------------------------------------------------------- Columns
  {
    method: 'get',
    path: '/api/columns',
    operationId: 'listColumns',
    tag: 'Columns',
    summary: 'The board columns, in order',
    description: 'Creates the five default columns the first time.',
    response: z.array(R.BoardColumn),
  },
  {
    method: 'post',
    path: '/api/columns',
    operationId: 'createColumn',
    tag: 'Columns',
    summary: 'Add a column at the end',
    body: upsertColumnSchema,
    response: R.BoardColumn,
    errors: { 400: BAD_BODY },
  },
  {
    method: 'patch',
    path: '/api/columns/{id}',
    operationId: 'updateColumn',
    tag: 'Columns',
    summary: 'Change some of a column',
    description: 'A new `status` is given to every card in the column, trashed ones included.',
    params: { id: ID },
    body: requestSchemas.UpdateColumn,
    response: R.BoardColumn,
    errors: { 400: BAD_BODY, 404: 'No such column for this owner.' },
  },
  {
    method: 'delete',
    path: '/api/columns/{id}',
    operationId: 'deleteColumn',
    tag: 'Columns',
    summary: 'Remove an empty column',
    params: { id: ID },
    response: R.BoardColumn,
    errors: {
      404: 'No such column for this owner.',
      409: 'The column still holds cards, live or in the trash.',
    },
  },
  {
    method: 'patch',
    path: '/api/columns/reorder',
    operationId: 'reorderColumns',
    tag: 'Columns',
    summary: 'Put the columns in this order',
    description: 'Ids that are not this owner’s columns are skipped.',
    body: reorderColumnsSchema,
    response: z.array(R.BoardColumn),
    errors: { 400: BAD_BODY },
  },

  // -------------------------------------------------------------- Projects
  {
    method: 'get',
    path: '/api/projects',
    operationId: 'listProjects',
    tag: 'Projects',
    summary: 'List projects with task counts and people',
    response: z.array(R.ProjectSummary),
  },
  {
    method: 'post',
    path: '/api/projects',
    operationId: 'createProject',
    tag: 'Projects',
    summary: 'Create a project',
    body: upsertProjectSchema,
    response: R.ProjectRow,
    errors: { 400: BAD_BODY },
  },
  {
    method: 'get',
    path: '/api/projects/{id}',
    operationId: 'getProject',
    tag: 'Projects',
    summary: 'One project with its tasks',
    params: { id: ID_OR_SLUG },
    response: R.ProjectDetail,
    errors: { 404: NOT_FOUND },
  },
  {
    method: 'patch',
    path: '/api/projects/{id}',
    operationId: 'updateProject',
    tag: 'Projects',
    summary: 'Replace a project',
    description:
      'Sends the whole project: absent fields take their defaults. Read it first. ' +
      'Clears `isDraft` unless it is sent as true.',
    params: { id: ID },
    body: upsertProjectSchema,
    response: R.ProjectRow,
    errors: { 400: BAD_BODY, 404: 'No such project for this owner.' },
  },
  {
    method: 'delete',
    path: '/api/projects/{id}',
    operationId: 'deleteProject',
    tag: 'Projects',
    summary: 'Move a project to the trash',
    params: { id: ID },
    response: R.ProjectRow,
    errors: { 404: 'No such project for this owner.' },
  },

  // ----------------------------------------------------------------- Edges
  {
    method: 'get',
    path: '/api/edges',
    operationId: 'listEdges',
    tag: 'Edges',
    summary: "A record's relationships, both directions, with the other side named",
    query: edgeListSchema,
    response: z.array(R.EdgeView),
    errors: { 400: 'A query parameter failed validation.', 404: 'No such record for this owner.' },
  },
  {
    method: 'post',
    path: '/api/edges',
    operationId: 'upsertEdge',
    tag: 'Edges',
    summary: 'Relate two records',
    description:
      'The same source, target and relation again updates its note and weight (weight defaults to 1).',
    body: edgeSchema,
    response: R.EntityEdge,
    errors: {
      400: BAD_BODY + ' Also: a record cannot relate to itself.',
      404: 'The source or target does not exist.',
    },
  },
  {
    method: 'delete',
    path: '/api/edges/{id}',
    operationId: 'deleteEdge',
    tag: 'Edges',
    summary: 'Remove a relationship for good',
    params: { id: 'The edge id.' },
    response: R.EntityEdge,
    errors: { 404: 'No such edge for this owner.' },
  },

  // -------------------------------------------------------------- Calendar
  {
    method: 'get',
    path: '/api/calendar',
    operationId: 'getCalendar',
    tag: 'Calendar',
    summary: 'Tasks, entries, projects and birthdays between two instants',
    query: calendarQuerySchema,
    response: z.array(R.CalendarEvent),
    errors: { 400: '`start` or `end` is missing or not a date.' },
  },
  {
    method: 'patch',
    path: '/api/calendar',
    operationId: 'rescheduleEvent',
    tag: 'Calendar',
    summary: 'Move a calendar item to a new date',
    description:
      'Name it by the `source` and `entityId` the calendar gave (a project by its slug). A ' +
      'span keeps its length unless `end` is sent; an all-day `end` is exclusive.',
    body: rescheduleSchema,
    response: z.union([R.ProjectRow, R.TaskRow, R.Entry]),
    errors: { 400: BAD_BODY, 404: 'No such record for this owner.' },
  },

  // ---------------------------------------------------------------- Search
  {
    method: 'get',
    path: '/api/search',
    operationId: 'search',
    tag: 'Search',
    summary: 'Search entries, contacts, tasks and projects, best first (up to 20)',
    query: z.object({ q: z.string().optional().meta({ description: 'Empty answers `[]`.' }) }),
    response: z.array(R.SearchHit),
  },
  {
    method: 'get',
    path: '/api/search/mentions',
    operationId: 'searchMentions',
    tag: 'Search',
    summary: 'Up to 8 suggestions for an `@` (contact) or `[[` (task or project) mention',
    query: mentionSearchSchema.extend({
      type: mentionSearchSchema.shape.type.default('contact'),
    }),
    response: z.array(R.MentionSuggestion),
    errors: { 400: '`type` is not `contact` or `entity`.' },
  },

  // ----------------------------------------------------------------- Trash
  {
    method: 'get',
    path: '/api/trash',
    operationId: 'listTrash',
    tag: 'Trash',
    summary: 'Everything in the trash, most recently deleted first',
    response: R.Trash,
  },
  {
    method: 'post',
    path: '/api/trash',
    operationId: 'trashAction',
    tag: 'Trash',
    summary: 'Restore a record, delete one for good, or empty the trash',
    description:
      '`restore` and `purge` need `kind` and `id`. `purge` and `empty` cannot be undone. ' +
      'Send the `deletedAt` the trash showed with a purge to refuse it if the record changed since.',
    body: trashActionSchema,
    response: R.TrashActionResult,
    errors: {
      400: BAD_BODY + ' Also: `kind` and `id` are missing.',
      404: 'No such record for this owner (restore).',
      409: 'The record is not in the trash, changed since `deletedAt`, or has live subtasks.',
    },
  },

  // -------------------------------------------------------------- Settings
  {
    method: 'get',
    path: '/api/settings',
    operationId: 'getSettings',
    tag: 'Settings',
    summary: "The owner's settings",
    response: R.Settings,
  },
  {
    method: 'patch',
    path: '/api/settings',
    operationId: 'updateSettings',
    tag: 'Settings',
    summary: 'Change some settings',
    description: 'Only the fields sent change.',
    body: settingsSchema,
    response: R.Settings,
    errors: { 400: BAD_BODY },
  },
  {
    method: 'get',
    path: '/api/weather',
    operationId: 'getWeather',
    tag: 'Settings',
    summary: 'Current weather at the configured place, when weather is turned on',
    description: 'The only call that reaches outside the machine (open-meteo.com).',
    response: R.Weather,
  },

  // ------------------------------------------------------------- Archive
  {
    method: 'get',
    path: '/desktop.webmanifest',
    operationId: 'getDesktopManifest',
    tag: 'System',
    summary: 'The web app manifest for installing the desktop GUI',
    description: 'The phone GUI uses `/manifest.webmanifest`; this one opens `/` instead of `/m`.',
    responseContent: {
      'application/manifest+json': { schema: { type: 'object', additionalProperties: true } },
    },
  },
  {
    method: 'get',
    path: '/api/export',
    operationId: 'exportArchive',
    tag: 'Files',
    summary: 'Download everything as one JSON archive',
    response: R.Archive,
    responseHeaders: {
      'Content-Disposition': 'attachment; filename="kinship-archive-<when>.json"',
    },
  },
  {
    method: 'post',
    path: '/api/import',
    operationId: 'importArchive',
    tag: 'Files',
    summary: 'Replace everything with an archive',
    description:
      'Deletes every row this owner has and writes the archive in its place. Needs ' +
      '`confirm=replace`. The body is at most about 9 MB.',
    query: z.object({
      confirm: z.literal('replace').meta({ description: 'Required, to say you mean it.' }),
      force: z
        .literal('1')
        .optional()
        .meta({ description: 'Import even when the archive is from another schema version.' }),
    }),
    body: requestSchemas.ArchiveImport,
    response: R.ImportSummary,
    errors: {
      400: 'No `confirm=replace`, the body is not JSON, or it is not a valid archive.',
      413: 'The archive is too large.',
    },
  },

  // ------------------------------------------------------------------ Agents
  {
    method: 'post',
    path: '/api/mcp',
    operationId: 'mcp',
    tag: 'Agents',
    summary: 'The MCP endpoint for AI agents (Streamable HTTP, stateless, JSON answers)',
    description:
      'Speaks the Model Context Protocol: point an MCP client at this address. Each request ' +
      'is one JSON-RPC message (or a batch) and is answered as JSON; there are no sessions. ' +
      'The body is at most 1 MB. Refusals by the protocol itself (JSON that is not ' +
      'JSON-RPC, a missing `Accept: application/json, text/event-stream`) answer a ' +
      'JSON-RPC error object. Tools: `tools/list`.',
    bodyContent: mcpContent('A JSON-RPC 2.0 request or notification, or an array of them.'),
    responseContent: mcpContent('The JSON-RPC 2.0 response, or an array of them.'),
    errors: {
      400: 'The body is not valid JSON.',
      404: 'Agent access is turned off (`KINSHIP_AGENT_ACCESS=off`).',
      413: 'The body is over 1 MB.',
      415: 'Content-Type is not `application/json`.',
    },
  },
  ...(['get', 'delete'] as const).map((method): ApiRoute => ({
    method,
    path: '/api/mcp',
    operationId: method === 'get' ? 'mcpStream' : 'mcpEndSession',
    tag: 'Agents',
    summary:
      method === 'get'
        ? 'Not offered: the endpoint opens no event stream'
        : 'Not offered: the endpoint keeps no sessions',
    errors: {
      404: 'Agent access is turned off (`KINSHIP_AGENT_ACCESS=off`).',
      405: 'Always, while the endpoint is on: send MCP requests by POST.',
    },
  })),

  // ----------------------------------------------------------------- Graph
  {
    method: 'get',
    path: '/api/graph',
    operationId: 'getGraph',
    tag: 'Graph',
    summary: "The owner's graph, or one record's neighbourhood",
    external: 'graph',
  },
]
