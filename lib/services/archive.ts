import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
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
import { prisma } from '../db'
import { ValidationError } from '../errors'
import { ownerUploadDir, uploadUrl } from '../uploads'
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

/** `Contact` -> `prisma.contact`, the Prisma delegate naming rule. */
function delegate(model: ModelName, client: Client | Tx = prisma): any {
  return (client as any)[model[0].toLowerCase() + model.slice(1)]
}

// ------------------------------------------------------------------- Export

const ROOT_MODELS = new Set<ModelName>([
  'Contact', 'EntityEdge', 'Entry', 'Project', 'BoardColumn', 'Task', 'Tag', 'Settings',
])

function ownerWhere(model: ModelName, owner: string): Record<string, unknown> {
  if (ROOT_MODELS.has(model)) return { owner }
  if (['ContactAttribute', 'ContactChannel', 'ContactPosition', 'ContactMilestone', 'ContactLink'].includes(model)) {
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
  const data: Archive['data'] = {}
  const counts: Record<string, number> = {}

  for (const model of MODEL_ORDER) {
    const rows: Record<string, unknown>[] = await delegate(model).findMany({
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
    migrations: await appliedMigrations(),
    counts,
    data,
    uploads: await readUploads(owner),
  }
}

/**
 * Row counts as they stand right now. Used by the CLI to spell out what an
 * import is about to destroy, before it destroys it.
 */
export async function currentCounts(owner: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const model of MODEL_ORDER) counts[model] = await delegate(model).count({ where: ownerWhere(model, owner) })
  return counts
}

async function appliedMigrations(): Promise<string[]> {
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
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

async function readUploads(owner: string): Promise<ArchiveUpload[]> {
  const directory = ownerUploadDir(owner)
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return [] // nothing has ever been uploaded on this machine
  }

  const uploads: ArchiveUpload[] = []
  for (const entry of entries) {
    // `.gitkeep` is the only dotfile expected here, but skipping all of them
    // keeps editor and sync droppings out of the archive too.
    if (!entry.isFile() || entry.name.startsWith('.')) continue
    const bytes = await readFile(path.join(directory, entry.name))
    uploads.push({ name: entry.name, data: bytes.toString('base64') })
  }
  return uploads.sort((a, b) => a.name.localeCompare(b.name))
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
  const declaredRows = MODEL_ORDER.reduce(
    (n, model) => n + (archive.data[model]?.length ?? 0),
    0,
  )
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

  // Files first, but under NEW names, and nothing existing is touched.
  //
  // K07: this used to write each upload to its own name from the archive, which
  // OVERWROTE any current file called the same thing — before the transaction
  // that could still fail. The comment here claimed a failure only left
  // unreferenced images behind, and that was false for exactly the case that
  // matters: a collision destroyed a live avatar and the database rollback
  // could not put it back. Staging under fresh names means a failed import can
  // only ever leave its own bytes behind, which `cleanupStaged` then removes.
  const staged = await stageUploads(owner, archive.uploads)
  const uploads = staged.size

  // The rows the archive carries still point at the OLD names, so rewrite them
  // to the staged ones before anything is committed. `Contact.avatarUrl` is the
  // only column in the schema that references an upload.
  rewriteAvatarUrls(prepared, staged)

  let counts: Record<string, number>
  try {
    counts = await prisma.$transaction(
      async (tx) => {
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
            await delegate(model, tx).createMany({ data: rows.slice(i, i + CHUNK) })
          }
        }
        return written
      },
      // A few hundred contacts restore in well under a second, but the default
      // 5 s ceiling is not a budget worth betting a whole migration on.
      { timeout: 120_000, maxWait: 20_000 },
    )
  } catch (err) {
    // The database is back where it was; take the staged files with it, so a
    // failed import leaves the uploads directory exactly as it found it.
    await cleanupStaged(owner, staged)
    throw err
  }

  return { counts, uploads, schemaDrift }
}

/** Database-enforced foreign keys, per model, and the model each one targets. */
const REFERENCES: Partial<Record<ModelName, [field: string, target: ModelName][]>> = {
  ContactAttribute: [['contactId', 'Contact']],
  ContactChannel: [['contactId', 'Contact']],
  ContactPosition: [['contactId', 'Contact']],
  ContactMilestone: [['contactId', 'Contact']],
  ContactLink: [['contactId', 'Contact']],
  BoardColumn: [['projectId', 'Project']],
  Task: [['projectId', 'Project'], ['parentTaskId', 'Task'], ['columnId', 'BoardColumn']],
  TaskAssignee: [['taskId', 'Task'], ['contactId', 'Contact']],
  Entry: [['projectId', 'Project']],
  Mention: [['entryId', 'Entry'], ['contactId', 'Contact']],
  EntityRef: [['entryId', 'Entry'], ['taskId', 'Task'], ['projectId', 'Project']],
  ContactTag: [['contactId', 'Contact'], ['tagId', 'Tag']],
  EntryTag: [['entryId', 'Entry'], ['tagId', 'Tag']],
  TaskTag: [['taskId', 'Task'], ['tagId', 'Tag']],
}

/** `EntityEdge` endpoints have no foreign key, so their types are mapped here. */
const EDGE_TARGETS: Record<string, ModelName> = {
  contact: 'Contact', entry: 'Entry', task: 'Task', project: 'Project',
}

/**
 * Every reference in an import must point at a row the same archive carries.
 * Root rows are re-stamped with the caller's owner, but child and join rows are
 * linked only by id — without this, a hand-edited archive could attach a
 * mention, tag or edge to another owner's contact.
 */
export function assertReferencesClosed(prepared: Partial<Record<ModelName, Record<string, unknown>[]>>) {
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

/**
 * Write the archive's uploads under fresh, immutable names, and return the
 * old-name -> new-name map so the rows can be repointed at them.
 *
 * Two properties, one per finding:
 *
 *  * **K07.** Every target name is a new UUID, so a write can never land on a
 *    file that is already here. Existing avatars are untouched until — and in
 *    fact regardless of whether — the import's transaction commits.
 *  * **K08.** Every payload is decoded and SNIFFED before it is written, and
 *    the extension comes from what the bytes are, not from the name the archive
 *    supplied. Nothing that is not one of the four raster types reaches
 *    the uploads directory, which this app serves back from its own origin
 *    through `app/uploads/[name]/route.ts`.
 *
 * Validation happens for ALL entries before the first byte is written, so a
 * hostile archive is rejected without having created anything at all.
 */
async function stageUploads(owner: string, uploads: ArchiveUpload[]): Promise<Map<string, string>> {
  const staged = new Map<string, string>()
  if (!uploads.length) return staged

  // Decode and check everything first — "rejected before any public file is
  // written" is the property, so a bad entry at index 40 must not leave 39
  // files behind.
  const checked: { from: string; to: string; bytes: Buffer }[] = []
  let decodedTotal = 0
  for (const file of uploads) {
    const bytes = Buffer.from(file.data, 'base64')
    // DECODED size, per file and cumulative. The body cap bounds the base64;
    // this bounds what it turns into, and every `bytes` here is held at once
    // until the write loop below runs.
    decodedTotal += bytes.byteLength
    if (bytes.byteLength > MAX_ARCHIVE_UPLOAD_BYTES) {
      throw new ValidationError(
        `Archive upload "${file.name}" decodes to ${Math.round(bytes.byteLength / 1024)} KB; ` +
          `the maximum for one image is ${MAX_ARCHIVE_UPLOAD_BYTES / (1024 * 1024)} MB. ` +
          'Nothing was written.',
      )
    }
    if (decodedTotal > MAX_ARCHIVE_UPLOAD_TOTAL_BYTES) {
      throw new ValidationError(
        `Archive uploads decode to more than ` +
          `${MAX_ARCHIVE_UPLOAD_TOTAL_BYTES / (1024 * 1024)} MB in total. Nothing was written.`,
      )
    }
    const mime = sniffImageType(bytes)
    if (!mime) {
      throw new ValidationError(
        `Archive upload "${file.name}" is not an image this app accepts. ` +
          `Uploads must be one of: ${allowedImageLabel()}. ` +
          'Nothing was written.',
      )
    }
    checked.push({ from: file.name, to: `${randomUUID()}.${extensionFor(mime)}`, bytes })
  }

  const directory = ownerUploadDir(owner)
  await mkdir(directory, { recursive: true })
  for (const item of checked) {
    const target = path.join(directory, item.to)
    // Belt and braces. The name is ours now, not the archive's, so this can no
    // longer fail — which is exactly why it is cheap to keep asserting.
    if (path.dirname(path.resolve(target)) !== path.resolve(directory)) {
      throw new ValidationError(`Refusing to write an upload outside the uploads directory: ${item.to}`)
    }
    await writeFile(target, item.bytes)
    staged.set(item.from, item.to)
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

/**
 * Remove what this import staged. Only ever its own files: every name in the
 * map was minted by `stageUploads` moments earlier, so nothing here can belong
 * to anything that was already on disk.
 */
async function cleanupStaged(owner: string, staged: Map<string, string>) {
  const directory = ownerUploadDir(owner)
  for (const name of staged.values()) {
    await rm(path.join(directory, name), { force: true }).catch(() => {})
  }
}
