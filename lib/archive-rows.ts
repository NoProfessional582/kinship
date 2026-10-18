import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { ARCHIVE_FORMAT } from './archive-format'
import { ValidationError } from './errors'
import { assertTaskTree } from './task-hierarchy'

/**
 * What an archive's rows are, and how they survive the trip through JSON.
 *
 * Split from `lib/services/archive.ts` so the fiddly parts — which tables in
 * which order, which columns are instants, which task has to be written before
 * which — can be tested without a database or a filesystem. This module knows
 * the schema; that one knows the machine.
 */

/**
 * Insertion order: every model appears exactly once, and only after the models
 * its foreign keys point at. Hand-written on purpose — Prisma 7's slimmed DMMF
 * no longer exposes `relationFromFields`, so the dependency graph cannot be
 * derived at runtime, and an ordering this load-bearing is worth reading in one
 * place. The same list is what an import truncates.
 *
 * Model name doubles as table name throughout: the schema uses no `@@map`, and
 * `assertModelsCovered` fails the moment that stops being true.
 */
export const MODEL_ORDER = [
  'Tag',
  'Contact',
  'ContactAttribute',
  'ContactChannel',
  'ContactPosition',
  'ContactMilestone',
  'ContactLink',
  'Project',
  'BoardColumn', // -> Project
  'Task', // -> Project, BoardColumn, and Task itself (see parentsFirst)
  'TaskAssignee', // -> Task, Contact
  'Entry', // -> Project
  'Mention', // -> Entry, Contact
  'EntityRef', // -> Entry, Task, Project
  'ContactTag',
  'EntryTag',
  'TaskTag',
  'EntityEdge', // no foreign keys at all: endpoints are (type, id) columns
  'Settings',
] as const

export type ModelName = (typeof MODEL_ORDER)[number]

type ModelShape = {
  /** Columns to read and write, in schema order. */
  fields: string[]
  /** Of those, the ones that arrive as ISO strings and must go back to Date. */
  dates: Set<string>
  /** Whether the model has a single `id` column, used for a stable sort. */
  hasId: boolean
}

/**
 * Column lists read from the DMMF rather than typed out, so a column added to
 * the schema is exported the day it lands instead of the day someone remembers
 * this file.
 *
 * `searchVector` is absent from the DMMF entirely because it is declared
 * `Unsupported("tsvector")` — which is exactly what we want. It is GENERATED
 * ALWAYS, Postgres rejects any attempt to write one, and it repopulates itself
 * from the restored rows. The same goes for every index and trigger: they
 * belong to the migrations, not to the data.
 */
export const SCHEMA: Record<ModelName, ModelShape> = (() => {
  const byName = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]))
  assertModelsCovered(byName)

  const out = {} as Record<ModelName, ModelShape>
  for (const name of MODEL_ORDER) {
    const model = byName.get(name)!
    // `kind` is 'object' for relation fields, which are navigation only and
    // have no column of their own; the foreign key sits beside them as a scalar.
    const scalars = model.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum')
    out[name] = {
      fields: scalars.map((f) => f.name),
      dates: new Set(scalars.filter((f) => f.type === 'DateTime').map((f) => f.name)),
      hasId: scalars.some((f) => f.name === 'id'),
    }
  }
  return out
})()

/**
 * A model added to the schema and forgotten here would be dropped from every
 * export without a word, and a move would lose it. Fail loudly instead.
 */
function assertModelsCovered(byName: Map<string, unknown>) {
  const listed = new Set<string>(MODEL_ORDER)
  const missing = [...byName.keys()].filter((m) => !listed.has(m))
  const stale = [...listed].filter((m) => !byName.has(m))
  if (missing.length || stale.length) {
    throw new Error(
      'MODEL_ORDER in lib/archive-rows.ts is out of sync with the Prisma schema: ' +
        [
          missing.length ? `missing ${missing.join(', ')}` : '',
          stale.length ? `unknown ${stale.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('; ') +
        '. Add it in foreign-key order.',
    )
  }
}

/**
 * Rows come back in a stable order, so two exports of an unchanged database are
 * byte-identical and can be diffed. The join tables have no `id`, so they sort
 * on their composite key instead.
 */
export function orderBy(model: ModelName) {
  const shape = SCHEMA[model]
  return shape.hasId ? [{ id: 'asc' as const }] : shape.fields.map((f) => ({ [f]: 'asc' as const }))
}

/** A filename for the download, stamped so two archives never collide. */
export function archiveFilename(at = new Date()): string {
  return `kinship-archive-${at.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
}

// -------------------------------------------------------------- Reading one

/**
 * Loose about the rows themselves on purpose: the columns are the schema's
 * business, and Prisma gives a better error about a bad one than a second
 * transcription of the schema would. This only checks that the file is an
 * archive at all.
 *
 * Archives from before photos were removed also carry `uploads` (base64
 * avatars); unknown keys are stripped here, so those still import, without
 * their photos.
 */
export const archiveSchema = z.object({
  format: z.literal(ARCHIVE_FORMAT, {
    message: 'Not a Kinship archive (missing the "kb-archive" marker)',
  }),
  version: z.number().int().positive(),
  exportedAt: z.string().optional(),
  migrations: z.array(z.string()).default([]),
  data: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
})

/**
 * JSON has no date type, so every instant arrives as a string and Prisma will
 * refuse it. Only the columns the DMMF calls DateTime are converted — a
 * heuristic on the value would eventually meet a note whose text happens to be
 * an ISO timestamp and turn it into one.
 *
 * Unknown keys are dropped rather than passed through: an archive written by an
 * older schema is missing columns, which take their defaults, and one that has
 * been hand-edited may carry keys that are not columns at all.
 */
export function reviveRow(model: ModelName, row: Record<string, unknown>): Record<string, unknown> {
  const { fields, dates } = SCHEMA[model]
  const out: Record<string, unknown> = {}

  for (const field of fields) {
    const value = row[field]
    if (value === undefined) continue
    if (value !== null && dates.has(field)) {
      const at = new Date(value as string)
      if (Number.isNaN(at.getTime())) {
        throw new ValidationError(`${model}.${field} is not a date: ${JSON.stringify(value)}`)
      }
      out[field] = at
      continue
    }
    out[field] = value
  }
  return out
}

/**
 * `Task.parentTaskId` points at `Task`, so a subtask written ahead of its parent
 * breaks the foreign key. Emit every parent before its children.
 *
 * Validate cycles before any file staging, then order iteratively so a deep
 * valid tree cannot overflow the JavaScript call stack.
 */
export function parentsFirst(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  assertTaskTree(
    rows.map((r) => ({ id: r.id as string, parentTaskId: r.parentTaskId as string | null })),
  )
  const byId = new Map(rows.map((r) => [r.id as string, r]))
  const seen = new Set<string>()
  const ordered: Record<string, unknown>[] = []
  for (const row of rows) {
    const chain: Record<string, unknown>[] = []
    let current: Record<string, unknown> | undefined = row
    while (current && !seen.has(current.id as string)) {
      seen.add(current.id as string)
      chain.push(current)
      current = byId.get(current.parentTaskId as string)
    }
    for (const ancestor of chain.reverse()) ordered.push(ancestor)
  }

  return ordered
}
