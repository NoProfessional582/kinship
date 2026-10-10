import type { contactsNeedingAttention } from './services/cadence'
import type { getCalendarEvents } from './services/calendar'
import type { getContactDossier, listContacts } from './services/contacts'
import type { edgesFor } from './services/edges'
import type { createEntry, getEntry, listEntries, updateEntry } from './services/entries'
import type { getProject, listProjects } from './services/projects'
import type { getBoard, getTask, listDrafts } from './services/tasks'
import type { listTrash } from './services/trash'

/**
 * What the API sends back, derived from the service behind each route so the
 * pages and the server cannot drift apart. Type-only: nothing here reaches the
 * browser bundle.
 */

/** A value after a trip through JSON: dates arrive as ISO strings. */
export type Jsonified<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonified<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonified<T[K]> }
      : T

type Response<F extends (...args: never[]) => Promise<unknown>> = Jsonified<Awaited<ReturnType<F>>>

/** One record's route: the service answers null for a missing one, the route a 404. */
type Found<F extends (...args: never[]) => Promise<unknown>> = NonNullable<Response<F>>

/** GET /api/tasks */
export type Board = Response<typeof getBoard>
export type BoardTask = Board['tasks'][number]
export type BoardColumn = Board['columns'][number]

/** GET /api/tasks/[id] */
export type TaskDetail = Found<typeof getTask>
export type TaskRecord = TaskDetail

/** GET /api/drafts */
export type Drafts = Response<typeof listDrafts>

/** GET /api/contacts */
export type ContactSummary = Response<typeof listContacts>[number]

/** GET /api/contacts/[id] */
export type ContactDossier = Found<typeof getContactDossier>
export type ContactRecord = ContactDossier['contact']

/** GET /api/entries */
export type EntryListItem = Response<typeof listEntries>[number]

/**
 * An entry as the cards and edit forms read it. Lists carry mentions, refs and
 * follow-up links; a contact's history carries none of them.
 */
export type EntryRecord = Omit<EntryListItem, 'mentions' | 'refs' | 'followUp' | 'followsUp'> &
  Partial<Pick<EntryListItem, 'mentions' | 'refs' | 'followUp' | 'followsUp'>>

/** GET /api/entries/[id] */
export type EntryDetail = Found<typeof getEntry>

/** POST /api/entries */
export type EntrySaved = Response<typeof createEntry>

/** PATCH /api/entries/[id] */
export type EntryUpdated = Response<typeof updateEntry>

/** GET /api/projects */
export type ProjectSummary = Response<typeof listProjects>[number]

/** GET /api/projects/[id] */
export type ProjectDetail = Found<typeof getProject>

/** GET /api/calendar */
export type CalendarEvents = Response<typeof getCalendarEvents>

/** GET /api/cadence */
export type CadenceContact = Response<typeof contactsNeedingAttention>[number]

/** GET /api/edges */
export type Edge = Response<typeof edgesFor>[number]

/** GET /api/trash */
export type Trash = Response<typeof listTrash>
