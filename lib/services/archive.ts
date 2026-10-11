import {
  recordRemovedPhotos,
  collectPhotosAfterCommit,
  protectReferencedPhotos,
  removeAttemptPhotos,
} from '../photo-lifecycle'
import { randomUUID, createHash } from 'node:crypto'
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  SCHEMA_MISMATCH,
  type Archive,
  type ArchiveUpload,
  type ImportSummary,
} from '../archive-format'
import {
  MODEL_ORDER,
  archiveSchema,
  orderBy,
  parentsFirst,
  reviveRow,
  type ModelName,
} from '../archive-rows'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db'
import { ValidationError } from '../errors'
import { lockOwnerGraph, ownerSnapshot } from '../owner-lock'
import { recomputeLastContact } from './recency'
import { uploadUrl, localPhotoName, readPhoto, writePhoto, listPhotos } from '../uploads'
import { allowedImageLabel, extensionFor, sniffImageType } from '../image-types'

/**
 * Whole-database export and import, for moving this app from one machine to
 * another.
 *
 * The archive is a single JSON document rather than a `pg_dump`, because a dump
 * is only restorable into the same Postgres major version and carries none of
 * the avatar files — and those live in a Docker volume, so a database-only move
 * silently leaves every dossier photo behind. One file that holds both is the
 * thing you can actually hand to another machine.
 *
 * Rows keep their original ids, so every foreign key, every `[[ref]]` and every
 * `EntityEdge` endpoint — a bare (type, id) pair with no foreign key to rewrite
 * it — still points at the same thing on the far side.
 */

export { ARCHIVE_FORMAT, ARCHIVE_VERSION } from '../archive-format'
export type { Archive, ArchiveUpload, ImportSummary } from '../archive-format'
export { archiveFilename } from '../archive-rows'

type Client = typeof prisma
type Tx = Omit<Client, '$transaction' | '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>

/** What the export does with every model's delegate. */
interface ArchiveReader {
  findMany(args: { where: object; orderBy: object }): Promise<Record<string, unknown>[]>
  count(args: { where: object }): Promise<number>
}

/** `Contact` -> `prisma.contact`, the Prisma delegate naming rule. */
function delegate(model: ModelName, db: Tx | Client = prisma): ArchiveReader {
  const key = (model[0].toLowerCase() + model.slice(1)) as Uncapitalize<ModelName>
  const d: ArchiveReader = db[key]
  return d
}

type Row = Record<string, unknown>

/**
 * Writes one chunk of revived rows. An archive's rows have no compile-time
 * type: `reviveRow` gives each one exactly the model's columns (read from
 * Prisma's own model metadata) with dates restored, and Postgres checks every
 * value on insert. Each entry says which Prisma input those rows are.
 */
const WRITERS: Record<ModelName, (tx: Tx, data: Row[]) => Promise<{ count: number }>> = {
  Tag: (tx, data) => tx.tag.createMany({ data: data as Prisma.TagCreateManyInput[] }),
  Contact: (tx, data) => tx.contact.createMany({ data: data as Prisma.ContactCreateManyInput[] }),
  ContactAttribute: (tx, data) =>
    tx.contactAttribute.createMany({ data: data as Prisma.ContactAttributeCreateManyInput[] }),
  ContactChannel: (tx, data) =>
    tx.contactChannel.createMany({ data: data as Prisma.ContactChannelCreateManyInput[] }),
  ContactPosition: (tx, data) =>
    tx.contactPosition.createMany({ data: data as Prisma.ContactPositionCreateManyInput[] }),
  ContactMilestone: (tx, data) =>
    tx.contactMilestone.createMany({ data: data as Prisma.ContactMilestoneCreateManyInput[] }),
  ContactLink: (tx, data) =>
    tx.contactLink.createMany({ data: data as Prisma.ContactLinkCreateManyInput[] }),
  Project: (tx, data) => tx.project.createMany({ data: data as Prisma.ProjectCreateManyInput[] }),
  BoardColumn: (tx, data) =>
    tx.boardColumn.createMany({ data: data as Prisma.BoardColumnCreateManyInput[] }),
  Task: (tx, data) => tx.task.createMany({ data: data as Prisma.TaskCreateManyInput[] }),
  TaskAssignee: (tx, data) =>
    tx.taskAssignee.createMany({ data: data as Prisma.TaskAssigneeCreateManyInput[] }),
  Entry: (tx, data) => tx.entry.createMany({ data: data as Prisma.EntryCreateManyInput[] }),
  Mention: (tx, data) => tx.mention.createMany({ data: data as Prisma.MentionCreateManyInput[] }),
  EntityRef: (tx, data) =>
    tx.entityRef.createMany({ data: data as Prisma.EntityRefCreateManyInput[] }),
  ContactTag: (tx, data) =>
    tx.contactTag.createMany({ data: data as Prisma.ContactTagCreateManyInput[] }),
  EntryTag: (tx, data) =>
    tx.entryTag.createMany({ data: data as Prisma.EntryTagCreateManyInput[] }),
  TaskTag: (tx, data) => tx.taskTag.createMany({ data: data as Prisma.TaskTagCreateManyInput[] }),
  EntityEdge: (tx, data) =>
    tx.entityEdge.createMany({ data: data as Prisma.EntityEdgeCreateManyInput[] }),
  Settings: (tx, data) =>
    tx.settings.createMany({ data: data as Prisma.SettingsCreateManyInput[] }),
}

// ------------------------------------------------------------------- Export

const ROOT_MODELS = new Set<ModelName>([
  'Contact',
  'EntityEdge',
  'Entry',
  'Project',
  'BoardColumn',
  'Task',
  'Tag',
  'Settings',
])

function ownerWhere(model: ModelName, owner: string): Record<string, unknown> {
  if (ROOT_MODELS.has(model)) return { owner }
  if (
    [
      'ContactAttribute',
      'ContactChannel',
      'ContactPosition',
      'ContactMilestone',
      'ContactLink',
    ].includes(model)
  ) {
    return { contact: { owner } }
  }
  if (model === 'Mention') return { entry: { owner } }
  if (model === 'EntityRef') return { entry: { owner } }
  if (model === 'TaskAssignee') return { task: { owner } }
  if (model === 'ContactTag') return { contact: { owner } }
  if (model === 'EntryTag') return { entry: { owner } }
  if (model === 'TaskTag') return { task: { owner } }
  throw new Error(`No ownership predicate for ${model}`)
}

export async function exportArchive(owner: string): Promise<Archive> {
  return ownerSnapshot(owner, async (tx) => {
    const data: Archive['data'] = {}
    const counts: Record<string, number> = {}

    for (const model of MODEL_ORDER) {
      const rows: Record<string, unknown>[] = await delegate(model, tx).findMany({
        where: ownerWhere(model, owner),
        orderBy: orderBy(model),
      })
      data[model] = rows
      counts[model] = rows.length
    }

    return {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      exportedAt: new Date().toISOString(),
      migrations: await appliedMigrations(tx),
      counts,
      data,
      uploads: await readUploads(owner, data.Contact ?? []),
    }
  })
}

/**
 * Row counts as they stand right now. Used by the CLI to spell out what an
 * import is about to destroy, before it destroys it.
 */
export async function currentCounts(owner: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const model of MODEL_ORDER)
    counts[model] = await delegate(model).count({ where: ownerWhere(model, owner) })
  return counts
}

async function appliedMigrations(db: Tx | Client = prisma): Promise<string[]> {
  try {
    const [ledger] = await db.$queryRaw<{ present: boolean }[]>`
      SELECT to_regclass('"_prisma_migrations"') IS NOT NULL AS present
    `
    if (!ledger.present) return []
    const rows = await db.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name ASC
    `
    return rows.map((r) => r.migration_name)
  } catch {
    // A database stood up with `prisma db push` has no ledger. That is a valid
    // way to run the app, so it costs the archive its schema check rather than
    // its export.
    return []
  }
}

async function readUploads(owner: string, contacts: Row[]): Promise<ArchiveUpload[]> {
  const names = new Set<string>()
  for (const row of contacts) {
    const name = localPhotoName(row.avatarUrl)
    if (name) names.add(name)
  }
  const uploads: ArchiveUpload[] = []
  for (const name of [...names].sort()) {
    const bytes = await readPhoto(owner, name)
    uploads.push({ name, data: bytes.toString('base64') })
  }
  return uploads
}

// ------------------------------------------------------------------- Import

export type ImportOptions = {
  /** Restore even though the archive's migrations differ from this database's. */
  force?: boolean
}

/** Rows per `createMany`. See the note at the call site. */
const CHUNK = 250

/**
 * Replaces everything. Every table is truncated and rebuilt from the archive
 * inside one transaction, so a failure anywhere leaves the database exactly as
 * it was rather than half-migrated.
 */
/**
 * Independent ceilings on what one archive may declare.
 *
 * The 10MB body cap in lib/body-limit.ts bounds the bytes on the wire, but not
 * what they expand into: JSON amplifies, and ten megabytes of `{"id":1},...`
 * becomes far more than ten megabytes of JavaScript objects once every row is
 * revived and held in `prepared` at the same time. base64 amplifies in the
 * other direction — 10MB of it decodes to ~7.5MB of image bytes, all of which
 * `stageUploads` holds in memory together before writing any of them.
 *
 * So these are checked separately from the body size, which is what "cap total
 * archive bytes, row count, upload count and decoded payload size
 * independently" means.
 *
 * Sized against the real thing rather than guessed: a full export of this
 * database is 1,275 rows across 19 tables, 0 uploads, 0.45 MiB total. Every
 * ceiling below is at least two orders of magnitude above that, so it bounds a
 * hostile archive without ever being reachable by an honest one.
 */
const MAX_ARCHIVE_ROWS = 200_000
const MAX_ARCHIVE_UPLOADS = 2_000
const MAX_ARCHIVE_UPLOAD_BYTES = 5 * 1024 * 1024
// ⚠️ Must be REACHABLE from within MAX_ARCHIVE_BYTES or it is decoration. A
// 9 MiB body of base64 decodes to at most ~6.75 MiB, so a 10 MiB total could
// never have fired — a cap that cannot trip is worse than none, because it
// reads as protection. Six is under that ceiling and still 6 MiB more of
// avatars than any archive this app has produced.
const MAX_ARCHIVE_UPLOAD_TOTAL_BYTES = 6 * 1024 * 1024

export async function importArchive(
  owner: string,
  input: unknown,
  { force = false }: ImportOptions = {},
): Promise<ImportSummary> {
  const parsed = archiveSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(
      `That file is not a valid archive: ${parsed.error.issues[0]?.message ?? 'unrecognised shape'}`,
    )
  }
  const archive = parsed.data

  if (archive.version > ARCHIVE_VERSION) {
    throw new ValidationError(
      `Archive format v${archive.version} was written by a newer version of this app ` +
        `(this one reads up to v${ARCHIVE_VERSION}). Update before importing.`,
    )
  }

  const unknownModels = Object.keys(archive.data).filter(
    (m) => !(MODEL_ORDER as readonly string[]).includes(m),
  )
  if (unknownModels.length) {
    throw new ValidationError(
      `Archive holds tables this app does not know: ${unknownModels.join(', ')}. ` +
        'It was written by a newer schema.',
    )
  }

  // Counted BEFORE `prepared` is built, because building it is the allocation
  // being bounded — discovering the archive was enormous afterwards is the same
  // mistake `file.read()` made on the jobs side.
  const declaredRows = MODEL_ORDER.reduce((n, model) => n + (archive.data[model]?.length ?? 0), 0)
  if (declaredRows > MAX_ARCHIVE_ROWS) {
    throw new ValidationError(
      `Archive declares ${declaredRows.toLocaleString()} rows; the maximum is ` +
        `${MAX_ARCHIVE_ROWS.toLocaleString()}. Nothing was changed.`,
    )
  }
  if (archive.uploads.length > MAX_ARCHIVE_UPLOADS) {
    throw new ValidationError(
      `Archive declares ${archive.uploads.length.toLocaleString()} uploads; the maximum ` +
        `is ${MAX_ARCHIVE_UPLOADS.toLocaleString()}. Nothing was changed.`,
    )
  }

  const schemaDrift = await checkSchema(archive.migrations, force)

  // Rows are prepared before anything is destroyed: a date that will not parse
  // should fail while the old data is still there.
  const prepared = {} as Record<ModelName, Record<string, unknown>[]>
  for (const model of MODEL_ORDER) {
    const rows = (archive.data[model] ?? []).map((row) => {
      const revived = reviveRow(model, row)
      delete revived.owner
      // Settings ids carry no references, and a legacy `singleton` id would
      // collide with whichever owner already holds it.
      if (model === 'Settings') delete revived.id
      return ROOT_MODELS.has(model) ? { ...revived, owner } : revived
    })
    prepared[model] = model === 'Task' ? parentsFirst(rows) : rows
  }

  // This owner's graph is replaced wholesale, so an id the archive does not
  // define could only resolve to ANOTHER owner's row. Refuse before touching
  // files or the database.
  assertReferencesClosed(prepared)

  // Validate every payload, even legacy orphans, before acquiring/mutating files.
  const checked = validateUploads(archive.uploads)
  const required = new Set<string>()
  for (const row of prepared.Contact) {
    const name = localPhotoName(row.avatarUrl)
    if (name) required.add(name)
  }
  for (const name of required) {
    if (!checked.has(name))
      throw new ValidationError(
        `Archive is missing referenced photo "${name}". Nothing was changed.`,
      )
  }

  const created = new Set<string>()
  let result: { counts: Record<string, number>; uploads: number; candidates: Set<string> }
  try {
    result = await prisma.$transaction(
      async (tx) => {
        await lockOwnerGraph(tx, owner)
        const previous = await tx.contact.findMany({
          where: { owner },
          select: { avatarUrl: true },
        })
        const staged = await stageUploads(owner, checked, required, created)
        rewriteAvatarUrls(prepared, staged)
        // Delete only this owner's graph. Root cascades remove all child/join
        // rows; no import may replace another owner's data.
        await tx.entityEdge.deleteMany({ where: { owner } })
        await tx.settings.deleteMany({ where: { owner } })
        await tx.entry.deleteMany({ where: { owner } })
        await tx.boardColumn.deleteMany({ where: { owner } })
        await tx.task.deleteMany({ where: { owner } })
        await tx.project.deleteMany({ where: { owner } })
        await tx.contact.deleteMany({ where: { owner } })
        await tx.tag.deleteMany({ where: { owner } })

        const written: Record<string, number> = {}
        for (const model of MODEL_ORDER) {
          const rows = prepared[model]
          written[model] = rows.length
          // Chunked so a wide table cannot walk into Postgres's 65 535 bound
          // parameters per statement: 250 rows x ~30 columns leaves room to spare.
          for (let i = 0; i < rows.length; i += CHUNK) {
            await WRITERS[model](tx, rows.slice(i, i + CHUNK))
          }
        }
        await recomputeLastContact(
          tx,
          owner,
          (prepared.Contact ?? []).map((r) => r.id as string),
        )

        await protectReferencedPhotos(tx, owner)
        const retained = new Set(staged.values())
        const candidates = new Set<string>()
        for (const row of previous) {
          try {
            const name = localPhotoName(row.avatarUrl)
            if (name && !retained.has(name)) candidates.add(name)
          } catch {
            /* Invalid legacy references are never cleanup candidates. */
          }
        }
        await recordRemovedPhotos(owner, candidates, Date.now(), 'restore')
        return { counts: written, uploads: staged.size, candidates }
      },
      { timeout: 120_000, maxWait: 20_000, isolationLevel: 'ReadCommitted' },
    )
  } catch (err) {
    // Rollback releases the transaction lock. Reacquire before removing attempt
    // files: another import could have reused one while this attempt rolled back.
    if (created.size) {
      await removeAttemptPhotos(owner, created).catch((cleanupError) =>
        console.warn('Could not coordinate restore rollback cleanup', cleanupError),
      )
    }
    throw err
  }

  await collectPhotosAfterCommit(owner)
  // Count referenced archive names resolved, including reuse, not physical writes.
  return { counts: result.counts, uploads: result.uploads, schemaDrift }
}

/** Database-enforced foreign keys, per model, and the model each one targets. */
const REFERENCES: Partial<Record<ModelName, [field: string, target: ModelName][]>> = {
  ContactAttribute: [['contactId', 'Contact']],
  ContactChannel: [['contactId', 'Contact']],
  ContactPosition: [['contactId', 'Contact']],
  ContactMilestone: [['contactId', 'Contact']],
  ContactLink: [['contactId', 'Contact']],
  BoardColumn: [['projectId', 'Project']],
  Task: [
    ['projectId', 'Project'],
    ['parentTaskId', 'Task'],
    ['columnId', 'BoardColumn'],
  ],
  TaskAssignee: [
    ['taskId', 'Task'],
    ['contactId', 'Contact'],
  ],
  Entry: [['projectId', 'Project']],
  Mention: [
    ['entryId', 'Entry'],
    ['contactId', 'Contact'],
  ],
  EntityRef: [
    ['entryId', 'Entry'],
    ['taskId', 'Task'],
    ['projectId', 'Project'],
  ],
  ContactTag: [
    ['contactId', 'Contact'],
    ['tagId', 'Tag'],
  ],
  EntryTag: [
    ['entryId', 'Entry'],
    ['tagId', 'Tag'],
  ],
  TaskTag: [
    ['taskId', 'Task'],
    ['tagId', 'Tag'],
  ],
}

/** `EntityEdge` endpoints have no foreign key, so their types are mapped here. */
const EDGE_TARGETS: Record<string, ModelName> = {
  contact: 'Contact',
  entry: 'Entry',
  task: 'Task',
  project: 'Project',
}

/**
 * Every reference in an import must point at a row the same archive carries.
 * Root rows are re-stamped with the caller's owner, but child and join rows are
 * linked only by id — without this, a hand-edited archive could attach a
 * mention, tag or edge to another owner's contact.
 */
export function assertReferencesClosed(
  prepared: Partial<Record<ModelName, Record<string, unknown>[]>>,
) {
  const ids = new Map<ModelName, Set<unknown>>()
  const idsOf = (model: ModelName) => {
    let set = ids.get(model)
    if (!set) ids.set(model, (set = new Set((prepared[model] ?? []).map((r) => r.id))))
    return set
  }
  const refuse = (model: string, field: string, value: unknown): never => {
    throw new ValidationError(
      `${model}.${field} refers to ${JSON.stringify(value)}, which this archive does not contain. ` +
        'An import may only link rows it carries itself. Nothing was changed.',
    )
  }

  for (const [model, refs] of Object.entries(REFERENCES) as [ModelName, [string, ModelName][]][]) {
    for (const row of prepared[model] ?? []) {
      for (const [field, target] of refs) {
        const value = row[field]
        if (value != null && !idsOf(target).has(value)) refuse(model, field, value)
      }
    }
  }
  for (const row of prepared.EntityEdge ?? []) {
    for (const side of ['source', 'target'] as const) {
      const target = EDGE_TARGETS[row[`${side}Type`] as string]
      const value = row[`${side}Id`]
      if (!target || !idsOf(target).has(value)) refuse('EntityEdge', `${side}Id`, value)
    }
  }
}

async function checkSchema(
  archiveMigrations: string[],
  force: boolean,
): Promise<ImportSummary['schemaDrift']> {
  const here = await appliedMigrations()
  if (!here.length || !archiveMigrations.length) return null // no ledger to compare

  const missing = archiveMigrations.filter((m) => !here.includes(m))
  const extra = here.filter((m) => !archiveMigrations.includes(m))
  if (!missing.length && !extra.length) return null

  if (!force) {
    throw new ValidationError(
      `${SCHEMA_MISMATCH} ` +
        [
          missing.length ? `Not applied here: ${missing.join(', ')}` : '',
          extra.length ? `Applied here but not in the archive: ${extra.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('. ') +
        '. Bring both sides to the same migrations, or override this check to import anyway.',
    )
  }
  return { missing, extra }
}

type CheckedUpload = { bytes: Buffer; extension: string }

/** Validate ALL payloads before mutation, including older archives' orphan bytes. */
function validateUploads(uploads: ArchiveUpload[]): Map<string, CheckedUpload> {
  const checked = new Map<string, CheckedUpload>()
  let decodedTotal = 0
  for (const file of uploads) {
    const bytes = Buffer.from(file.data, 'base64')
    decodedTotal += bytes.byteLength
    if (bytes.byteLength > MAX_ARCHIVE_UPLOAD_BYTES)
      throw new ValidationError(
        `Archive upload "${file.name}" exceeds the maximum for one image. Nothing was written.`,
      )
    if (decodedTotal > MAX_ARCHIVE_UPLOAD_TOTAL_BYTES)
      throw new ValidationError(
        `Archive uploads decode to more than ${MAX_ARCHIVE_UPLOAD_TOTAL_BYTES / (1024 * 1024)} MB in total. Nothing was written.`,
      )
    const mime = sniffImageType(bytes)
    if (!mime)
      throw new ValidationError(
        `Archive upload "${file.name}" is not an image this app accepts. Uploads must be one of: ${allowedImageLabel()}. Nothing was written.`,
      )
    const previous = checked.get(file.name)
    if (previous && !previous.bytes.equals(bytes))
      throw new ValidationError(
        `Archive has conflicting payloads for photo "${file.name}". Nothing was written.`,
      )
    checked.set(file.name, { bytes, extension: extensionFor(mime) })
  }
  return checked
}

/** Caller holds the owner transaction lock through staging and replacement commit. */
async function stageUploads(
  owner: string,
  checked: Map<string, CheckedUpload>,
  required: Set<string>,
  created: Set<string>,
): Promise<Map<string, string>> {
  const staged = new Map<string, string>()
  if (!required.size) return staged
  // Hashes index candidates only; every reuse also compares the complete bytes.
  // Do not retain an entire legacy directory's image bytes in memory.
  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  const existing = new Map<string, string[]>()
  const index = (name: string, bytes: Buffer) => {
    const key = digest(bytes)
    existing.set(key, [...(existing.get(key) ?? []), name])
  }
  for (const name of await listPhotos(owner)) {
    try {
      index(name, await readPhoto(owner, name, MAX_ARCHIVE_UPLOAD_BYTES))
    } catch {
      /* Unsafe/non-image/oversized legacy entries cannot be reused. */
    }
  }
  for (const from of [...required].sort()) {
    const item = checked.get(from)!
    let matching: string | undefined
    const candidates = [...(existing.get(digest(item.bytes)) ?? [])]
    candidates.sort((a, b) => (a === from ? -1 : b === from ? 1 : a.localeCompare(b)))
    for (const name of candidates) {
      if ((await readPhoto(owner, name, MAX_ARCHIVE_UPLOAD_BYTES)).equals(item.bytes)) {
        matching = name
        break
      }
    }
    if (matching) {
      staged.set(from, matching)
      continue
    }
    const to = `${randomUUID()}.${item.extension}`
    await writePhoto(owner, to, item.bytes)
    created.add(to)
    index(to, item.bytes)
    staged.set(from, to)
  }
  return staged
}

/**
 * Repoint the incoming rows at the staged filenames. `Contact.avatarUrl` is the
 * only column in the schema that holds an upload reference; a value the archive
 * did not ship a file for is left exactly as it is, because it may well be an
 * external URL.
 */
function rewriteAvatarUrls(
  prepared: Record<ModelName, Record<string, unknown>[]>,
  staged: Map<string, string>,
) {
  if (!staged.size) return
  for (const row of prepared.Contact ?? []) {
    const current = row.avatarUrl
    if (typeof current !== 'string') continue
    const name = current.startsWith('/uploads/') ? current.slice('/uploads/'.length) : null
    const replacement = name ? staged.get(name) : undefined
    if (replacement) row.avatarUrl = uploadUrl(replacement)
  }
}
