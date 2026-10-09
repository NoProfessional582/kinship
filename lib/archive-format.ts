/**
 * The archive's wire contract — what a `.json` export claims to be, what it
 * holds, and the shape of the answer an import gives back.
 *
 * Deliberately free of every other import. `lib/archive-rows.ts` needs the
 * Prisma DMMF and `lib/services/archive.ts` needs a database and a filesystem,
 * but the settings page is a client component and can have neither, so the
 * handful of values both sides share live here on their own.
 */

/**
 * The marker every archive carries. It keeps the name from before the app was
 * Kinship, so archives move both ways between the old app and Kinship; only
 * the download's filename changed (`kinship-archive-…json`).
 */
export const ARCHIVE_FORMAT = 'kb-archive'

/**
 * Bump only for a change an older reader could not survive. Adding a table or a
 * column is not one: an import takes the columns it recognises and lets the
 * rest default, so archives stay readable across ordinary schema growth.
 */
export const ARCHIVE_VERSION = 1

/**
 * How a schema mismatch opens. The settings page matches on it to decide
 * whether to offer "import anyway", so it lives here rather than being typed
 * out on both sides.
 */
export const SCHEMA_MISMATCH = 'This database is on a different schema than the archive.'

/** An avatar, base64-encoded. They live in a Docker volume, not the database. */
export type ArchiveUpload = { name: string; data: string }

export type Archive = {
  format: typeof ARCHIVE_FORMAT
  version: number
  exportedAt: string
  /** Applied migrations, so an import can refuse a schema it does not match. */
  migrations: string[]
  counts: Record<string, number>
  data: Record<string, Record<string, unknown>[]>
  uploads: ArchiveUpload[]
}

export type ImportSummary = {
  /** Rows written, per table. */
  counts: Record<string, number>
  uploads: number
  /** Set only when a mismatch was forced past, naming what differed. */
  schemaDrift: { missing: string[]; extra: string[] } | null
}
