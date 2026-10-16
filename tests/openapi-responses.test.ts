import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import type * as Api from '@/lib/api-types'
import type { Jsonified } from '@/lib/api-types'
import * as R from '@/lib/openapi/responses'
import type { getContact, createContact } from '@/lib/services/contacts'
import type { emptyTrash } from '@/lib/services/trash'
import type { createTask, getTask } from '@/lib/services/tasks'
import type { createProject } from '@/lib/services/projects'
import type { upsertEdge } from '@/lib/services/edges'
import type { deleteEntry } from '@/lib/services/entries'
import type { searchMentions, globalSearch } from '@/lib/services/search'
import type { ImportSummary, Archive } from '@/lib/services/archive'

/**
 * The response schemas are written by hand from the services, so the type
 * checker holds them to it: each service's answer, after JSON, must be a value
 * its schema accepts. A field the schema forgot to allow, or typed wrongly,
 * fails `npm run typecheck` here. (Extra schema fields the service never sends
 * are what the contract tests against the running stack catch.)
 */
type Answer<F extends (...args: never[]) => Promise<unknown>> = Wire<
  Jsonified<Awaited<ReturnType<F>>>
>

/**
 * Prisma types `Contact.customFields` as any JSON value; every write stores an
 * object (the input schema is a record), and the spec says so.
 */
type Wire<T> = T extends (infer U)[]
  ? Wire<U>[]
  : T extends object
    ? { [K in keyof T]: K extends 'customFields' ? Record<string, unknown> : Wire<T[K]> }
    : T

/** Compiles only when `value` fits the schema's output type. */
function fits<S extends z.ZodType>(schema: S, value?: z.output<S>): S {
  void value
  return schema
}

/**
 * Not checked here, because the service's type is looser than its answer, and
 * the contract tests check the real thing instead: soft deletes (typed as
 * `{ id, deletedAt }`, answered with the whole row) and the trash list (typed
 * with a nullable `deletedAt` that its query rules out).
 */
const checked = [
  fits(R.ContactSummary, undefined as unknown as Wire<Api.ContactSummary>),
  fits(R.ContactDossier, undefined as unknown as Wire<Api.ContactDossier>),
  fits(R.ContactDetail, undefined as unknown as NonNullable<Answer<typeof getContact>>),
  fits(R.ContactDetail, undefined as unknown as Answer<typeof createContact>),
  fits(R.CadenceContact, undefined as unknown as Wire<Api.CadenceContact>),
  fits(R.EntryWithFollowUps, undefined as unknown as Wire<Api.EntryListItem>),
  fits(R.EntryWithFollowUps, undefined as unknown as Wire<Api.EntryDetail>),
  fits(R.EntrySaved, undefined as unknown as Wire<Api.EntrySaved>),
  fits(R.EntrySaved, undefined as unknown as Wire<Api.EntryUpdated>),
  fits(R.EntryRow, undefined as unknown as Answer<typeof deleteEntry>),
  fits(R.Board, undefined as unknown as Wire<Api.Board>),
  fits(R.TaskDetail, undefined as unknown as Answer<typeof createTask>),
  fits(R.TaskWithParent, undefined as unknown as NonNullable<Answer<typeof getTask>>),
  fits(R.Drafts, undefined as unknown as Wire<Api.Drafts>),
  fits(R.ProjectSummary, undefined as unknown as Wire<Api.ProjectSummary>),
  fits(R.ProjectDetail, undefined as unknown as Wire<Api.ProjectDetail>),
  fits(R.ProjectRow, undefined as unknown as Answer<typeof createProject>),
  fits(R.CalendarEvent, undefined as unknown as Wire<Api.CalendarEvents[number]>),
  fits(R.EdgeView, undefined as unknown as Wire<Api.Edge>),
  fits(R.EntityEdge, undefined as unknown as Answer<typeof upsertEdge>),
  fits(R.TrashEmptied, undefined as unknown as Answer<typeof emptyTrash>),
  fits(R.SearchHit, undefined as unknown as Answer<typeof globalSearch>[number]),
  fits(R.MentionSuggestion, undefined as unknown as Answer<typeof searchMentions>[number]),
  fits(R.ImportSummary, undefined as unknown as Wire<ImportSummary>),
  fits(R.Archive, undefined as unknown as Wire<Archive>),
]

describe('API response schemas', () => {
  it('are each held to their service by the type checker', () => {
    expect(checked.every((s) => typeof s.safeParse === 'function')).toBe(true)
  })
})
