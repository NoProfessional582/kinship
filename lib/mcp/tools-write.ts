import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '../db'
import { found } from '../api'
import { createContact, deleteContact, getContact, updateContact } from '../services/contacts'
import { deleteEdge, upsertEdge } from '../services/edges'
import { createEntry, deleteEntry, updateEntry } from '../services/entries'
import { createProject, deleteProject, getProject, updateProject } from '../services/projects'
import { createTask, deleteTask, getTask, moveTask, updateTask } from '../services/tasks'
import type * as R from '../openapi/responses'
import {
  BODY_MAX,
  createEntrySchema,
  edgeSchema,
  moveTaskSchema,
  updateEntrySchema,
  upsertContactSchema,
  upsertProjectSchema,
  upsertTaskSchema,
} from '../validation'
import { agentShape } from './agent-schema'
import { contactInput, overlay, projectInput, taskInput } from './current'
import { runTool } from './results'
import { USER_CONTENT } from './tools-read'
import * as T from './trim'

/**
 * The write tools, offered only while the owner's agent access is `write` (server.ts).
 * Each parses with its REST route's schema and calls that route's service, so a change
 * made here is the change the app would make. None of them deletes anything for good:
 * `trash_record` moves a record to the Trash, where the owner can restore it. Settings,
 * emptying the Trash, archive import and photo upload have no tool, on purpose.
 */

type Out<S extends z.ZodType> = z.output<S>

/** Every write tool, by name: the ones read-only access hides and refuses. */
export const WRITE_TOOLS = [
  'create_contact',
  'create_project',
  'create_task',
  'link_records',
  'log_entry',
  'move_task',
  'trash_record',
  'unlink_records',
  'update_contact',
  'update_entry',
  'update_project',
  'update_task',
] as const

/** What a client is told when it calls a write tool while access is read only. */
export const readOnlyRefusal = (tool: string) =>
  `Kinship's agent access is read only, so ${tool} is turned off and nothing was changed. ` +
  'The owner can allow changes again in Kinship, under Settings → Agent access.'

const CHANGES = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const
const EDITS = { ...CHANGES, idempotentHint: true } as const
const REMOVES = { ...EDITS, destructiveHint: true } as const

/** Said by every update tool. */
const PARTIAL =
  'Send only the fields to change: fields left out stay as they are, and `null` clears ' +
  'one. A list you send (tags, channels...) replaces the whole list.'

const id = (what: string) => z.string().trim().min(1).meta({ description: what })

const noteBody = z
  .string()
  .min(1)
  .max(BODY_MAX)
  .meta({
    description:
      'The note as plain text. Blank lines separate paragraphs; lines starting `- ` are ' +
      'bullets. Mention people as `@[Jane Doe](contact:<id>)`, tasks as ' +
      '`[[Ship v2]](task:<id>)`, projects as `[[Launch]](project:<id>)`; the id `new` ' +
      'creates a draft record with that name.',
  })

const ENTRY_OMIT = ['bodyJson', 'pendingEntities', 'body']

export function registerWriteTools(server: McpServer, owner: string) {
  // ------------------------------------------------------------- Entries

  server.registerTool(
    'log_entry',
    {
      title: 'Log a note or interaction',
      description:
        'Saves a note, or a call, meeting, email... (`kind`, default NOTE), dated now unless ' +
        '`occurredAt` says otherwise. People, tasks and projects mentioned in `body` are ' +
        'linked to it, and a mentioned person’s last contact moves to its date. A mention ' +
        'with id `new` creates a draft record, listed in `created`. `followUpAt` adds a ' +
        'second, linked note on that date to pick the conversation back up.' +
        ' ' +
        USER_CONTENT,
      inputSchema: {
        body: noteBody,
        ...agentShape(createEntrySchema.shape, { omit: ENTRY_OMIT }),
      },
      annotations: CHANGES,
    },
    (args) =>
      runTool(
        () => createEntry(owner, createEntrySchema.parse(args)),
        (saved: Out<typeof R.EntrySaved>) => T.savedEntry(saved),
      ),
  )

  server.registerTool(
    'update_entry',
    {
      title: 'Update a note',
      description:
        'Changes a note or logged interaction. ' +
        PARTIAL +
        ' Sending `body` replaces the whole note text (read it first with get_entries).' +
        ' ' +
        USER_CONTENT,
      inputSchema: {
        id: id('The note’s id.'),
        body: noteBody.optional(),
        ...agentShape(updateEntrySchema.shape, { omit: ENTRY_OMIT, partial: true }),
      },
      annotations: EDITS,
    },
    ({ id, ...changes }) =>
      runTool(
        () => updateEntry(owner, id, updateEntrySchema.parse(changes)),
        (saved: Out<typeof R.EntrySaved>) => T.savedEntry(saved),
      ),
  )

  // ------------------------------------------------------------ Contacts

  server.registerTool(
    'create_contact',
    {
      title: 'Create a contact',
      description:
        'Adds a person. Only `displayName` is needed. `cadence` is how often the owner wants ' +
        'to be in touch (who_is_due uses it); `tier` how close they are (TIER_1 closest). ' +
        'Search first: the person may already be there, perhaps as a draft.' +
        ' ' +
        USER_CONTENT,
      inputSchema: agentShape(upsertContactSchema.shape, { omit: ['avatarUrl'] }),
      annotations: CHANGES,
    },
    (args) => runTool(() => createContact(owner, upsertContactSchema.parse(args)), T.contact),
  )

  server.registerTool(
    'update_contact',
    {
      title: 'Update a contact',
      description:
        'Changes a contact’s record. ' +
        PARTIAL +
        ' A draft (made from a `new` mention) stays a draft until `isDraft` is false.' +
        ' ' +
        USER_CONTENT,
      inputSchema: {
        id: id('The contact’s id (or slug).'),
        ...agentShape(upsertContactSchema.shape, { omit: ['avatarUrl'], partial: true }),
      },
      annotations: EDITS,
    },
    ({ id, ...changes }) =>
      runTool(async () => {
        const current = found(await getContact(owner, id))
        const input = upsertContactSchema.parse(overlay(contactInput(current), changes))
        return updateContact(owner, current.id, input)
      }, T.contact),
  )

  // --------------------------------------------------------------- Tasks

  server.registerTool(
    'create_task',
    {
      title: 'Create a task',
      description:
        'Adds a task card. Only `title` is needed; it goes to the board’s first column unless ' +
        '`columnId` says otherwise (list_board_columns), and its status is its column’s. ' +
        '`assigneeIds` are contact ids; `parentTaskId` makes it a subtask. Dates are calendar ' +
        'days while `allDay` is true (the default).' +
        ' ' +
        USER_CONTENT,
      inputSchema: agentShape(upsertTaskSchema.shape),
      annotations: CHANGES,
    },
    (args) => runTool(() => createTask(owner, upsertTaskSchema.parse(args)), T.task),
  )

  server.registerTool(
    'update_task',
    {
      title: 'Update a task',
      description:
        'Changes a task. ' +
        PARTIAL +
        ' A new `columnId` puts the card at the bottom of that column (move_task places it).' +
        ' ' +
        USER_CONTENT,
      inputSchema: {
        id: id('The task’s id (or slug).'),
        ...agentShape(upsertTaskSchema.shape, { partial: true }),
      },
      annotations: EDITS,
    },
    ({ id, ...changes }) =>
      runTool(async () => {
        const current = found(await getTask(owner, id))
        const input = upsertTaskSchema.parse(overlay(taskInput(current), changes))
        return updateTask(owner, current.id, input)
      }, T.task),
  )

  server.registerTool(
    'move_task',
    {
      title: 'Move a task on the board',
      description:
        'Moves a top-level card to a column (list_board_columns), which sets its status: a ' +
        'card in a done column is done. It goes to the bottom of the column, or next to ' +
        'the card named by `placeAfter` or `placeBefore`.' +
        ' ' +
        USER_CONTENT,
      inputSchema: {
        id: id('The task’s id (or slug).'),
        columnId: id('The column to move it to.'),
        placeAfter: id('Put it just below this card in the column.').optional(),
        placeBefore: id('Put it just above this card in the column.').optional(),
      },
      annotations: EDITS,
    },
    ({ id, columnId, placeAfter, placeBefore }) =>
      runTool(async () => {
        const current = found(await getTask(owner, id))
        // With no neighbour named, the slot after every other card in the column.
        const toIndex = await prisma.task.count({
          where: { owner, columnId, parentTaskId: null, deletedAt: null, NOT: { id: current.id } },
        })
        const move = moveTaskSchema.parse({
          columnId,
          toIndex,
          beforeId: placeAfter,
          afterId: placeBefore,
        })
        return moveTask(
          owner,
          current.id,
          move.columnId,
          move.toIndex,
          undefined,
          move.beforeId,
          move.afterId,
        )
      }, T.task),
  )

  // ------------------------------------------------------------ Projects

  server.registerTool(
    'create_project',
    {
      title: 'Create a project',
      description:
        'Adds a project. Only `name` is needed. Give tasks to it with create_task or ' +
        'update_task and `projectId`.' +
        ' ' +
        USER_CONTENT,
      inputSchema: agentShape(upsertProjectSchema.shape),
      annotations: CHANGES,
    },
    (args) => runTool(() => createProject(owner, upsertProjectSchema.parse(args)), T.projectRow),
  )

  server.registerTool(
    'update_project',
    {
      title: 'Update a project',
      description: 'Changes a project. ' + PARTIAL + ' ' + USER_CONTENT,
      inputSchema: {
        id: id('The project’s id (or slug).'),
        ...agentShape(upsertProjectSchema.shape, { partial: true }),
      },
      annotations: EDITS,
    },
    ({ id, ...changes }) =>
      runTool(async () => {
        const current = found(await getProject(owner, id))
        const input = upsertProjectSchema.parse(overlay(projectInput(current), changes))
        return updateProject(owner, current.id, input)
      }, T.projectRow),
  )

  // ------------------------------------------------------- Relationships

  server.registerTool(
    'link_records',
    {
      title: 'Link two records',
      description:
        'Saves a relationship from one record to another, in words: "introduced me to", ' +
        '"reports to", "works on". Linking the same pair with the same `relation` again ' +
        'updates its note and weight. get_neighbourhood lists a record’s relationships.' +
        ' ' +
        USER_CONTENT,
      inputSchema: agentShape(edgeSchema.shape),
      annotations: EDITS,
    },
    (args) => runTool(() => upsertEdge(owner, edgeSchema.parse(args)), T.edge),
  )

  server.registerTool(
    'unlink_records',
    {
      title: 'Remove a relationship',
      description:
        'Removes one saved relationship, by the `edgeId` get_neighbourhood gives. The two ' +
        'records stay; mentions in notes are not relationships and are not touched.',
      inputSchema: { edgeId: id('The relationship’s `edgeId`.') },
      annotations: REMOVES,
    },
    ({ edgeId }) =>
      runTool(
        () => deleteEdge(owner, edgeId),
        (e: Out<typeof R.EntityEdge>) => ({ removed: T.edge(e) }),
      ),
  )

  // --------------------------------------------------------------- Trash

  const TRASH = {
    contact: deleteContact,
    entry: deleteEntry,
    task: deleteTask,
    project: deleteProject,
  }

  server.registerTool(
    'trash_record',
    {
      title: 'Move a record to the Trash',
      description:
        'Moves a contact, note (`entry`), task or project to the Trash. It disappears from ' +
        'lists and search, and the owner can restore it from the Trash in Kinship. Nothing ' +
        'is deleted for good.',
      inputSchema: {
        kind: z.enum(['contact', 'entry', 'task', 'project']).meta({ description: 'What it is.' }),
        id: id('Its id.'),
      },
      annotations: REMOVES,
    },
    ({ kind, id }) =>
      runTool(
        () => TRASH[kind](owner, id),
        (row: { id: string; deletedAt: string }) => ({
          trashed: { kind, id: row.id, deletedAt: row.deletedAt },
        }),
      ),
  )
}
