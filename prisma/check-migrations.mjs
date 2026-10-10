#!/usr/bin/env node
/**
 * Refuse to apply a migration that would destroy something Prisma cannot see.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * This is recorded history, not a hypothetical. `searchVector` on `Contact` and
 * `Entry` is a `GENERATED ALWAYS … STORED` tsvector that the schema can only
 * describe as `Unsupported("tsvector")?`, so `prisma migrate dev` reads it and
 * everything built on it as drift and opens every generated migration by
 * dropping it. The final statement then errors on the generated column and the
 * migration fails — but the `DROP INDEX`es ahead of it are NOT rolled back.
 * `20260821194100_restore_search_indexes` exists to repair exactly that, and
 * `20260822204500` says in its own text that the proposal recurs "every time".
 *
 * Documentation already told people to use `--create-only` and hand-edit. This
 * is the same instruction with teeth, in the one place that cannot be skipped:
 * it runs in the `migrate` container before `prisma migrate deploy`, so a
 * migration carrying one of these drops is never applied — in dev, in CI, or in
 * production — whether or not a human was in the loop.
 *
 * ── What it protects ─────────────────────────────────────────────────────────
 * Enumerated from the live database rather than from the schema, because the
 * point is that the schema cannot express any of it. Note this is a larger set
 * than the prose usually quoted: SIX indexes, not three.
 *
 * ── The one thing it must NOT do ─────────────────────────────────────────────
 * Refuse legitimate maintenance. A generated column cannot be altered in place;
 * changing it means DROP then ADD in the same migration, which is what
 * 20260822204500 does deliberately. So a drop is only an error when the same
 * migration does not put the object back.
 *
 *   node prisma/check-migrations.mjs
 *
 * Exit 0 clean, 1 refused, 2 could not read the migrations.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

/** `GENERATED ALWAYS … STORED` columns: droppable only if re-added. */
const GENERATED_COLUMNS = [
  { table: 'Contact', column: 'searchVector' },
  { table: 'Entry', column: 'searchVector' },
]

/**
 * Indexes a generated migration proposes dropping.
 *
 * This list was built by RUNNING `prisma migrate diff` against a fresh database
 * after a single trivial column addition, not by reading the schema — and the
 * answer was bigger than expected. One added nullable column proposed EIGHT
 * `DROP INDEX` statements.
 *
 * Two different reasons, both here:
 *
 *  * GIN / trigram / functional indexes the schema cannot express at all.
 *  * `Entry_deletedAt_idx`, `Task_deletedAt_idx` and `Project_deletedAt_idx`,
 *    which were perfectly ordinary btree indexes that simply had never been
 *    written into schema.prisma — so Prisma read real indexes as drift. They
 *    are now declared (`@@index([deletedAt])` on those three models), which
 *    stops the proposal at source; they stay on this list because a
 *    declaration can be deleted again and the index is load-bearing for every
 *    soft-delete query in the app.
 */
const PROTECTED_INDEXES = [
  'Contact_search_idx',
  'Entry_search_idx',
  'Contact_name_trgm_idx',
  'Task_title_trgm_idx',
  'Project_name_trgm_idx',
  'Tag_name_normalized_key',
  'Entry_deletedAt_idx',
  'Task_deletedAt_idx',
  'Project_deletedAt_idx',
  'Contact_deletedAt_idx',
]

/** The generated columns' expression calls this; dropping it breaks them. */
const PROTECTED_FUNCTIONS = ['kb_array_to_string']

/** The trigram indexes cannot exist without it. */
const PROTECTED_EXTENSIONS = ['pg_trgm']

/** Tables whose loss would take a protected column or index with it. */
const PROTECTED_TABLES = [...new Set(GENERATED_COLUMNS.map((c) => c.table))]

/**
 * Comments carry the very words we search for — every hand-written migration in
 * this directory explains the drops it is avoiding — so they must go before any
 * matching, or the guard fails on its own documentation.
 */
function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

/**
 * Naive split on `;`. Sound for this directory: no statement here contains a
 * semicolon inside a string literal or a dollar-quoted body. If one ever does,
 * this over-splits and the guard gets MORE suspicious, never less.
 */
const statements = (sql) =>
  stripComments(sql)
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

/**
 * Match an object name quoted or bare, but never as a PREFIX of a longer one.
 *
 * Two bugs were found here by TESTING the guard rather than reading it, and
 * both are worth keeping in view:
 *
 *  * `"?Contact"?` also matched `"ContactAttribute"`, so the guard refused a
 *    migration in its own history — a false POSITIVE: loud, and harmless.
 *  * Wrapping the quoted form in `\b` never matched at all, because the
 *    boundary between a closing `"` and a space is not a word boundary. So
 *    `ALTER COLUMN "searchVector"` slipped straight through — a false
 *    NEGATIVE: silent, and the dangerous direction.
 *
 * Hence explicit lookaround here, and no `\b` at the call sites.
 */
const ident = (name) => `(?:"${name}"|(?<![A-Za-z0-9_"])${name}(?![A-Za-z0-9_"]))`

function findings(sql) {
  const stmts = statements(sql)
  const whole = stmts.join(' ; ')
  const out = []

  const dropsIndex = (i) => new RegExp(`DROP\\s+INDEX\\b[^;]*${ident(i)}`, 'i').test(whole)
  const createsIndex = (i) =>
    new RegExp(`CREATE\\s+(UNIQUE\\s+)?INDEX\\b[^;]*${ident(i)}`, 'i').test(whole)

  for (const index of PROTECTED_INDEXES) {
    if (dropsIndex(index) && !createsIndex(index)) {
      out.push(`drops index ${index} without recreating it`)
    }
  }

  for (const { table, column } of GENERATED_COLUMNS) {
    const dropped = stmts.some(
      (s) =>
        new RegExp(`^ALTER\\s+TABLE\\s+${ident(table)}`, 'i').test(s) &&
        new RegExp(`DROP\\s+COLUMN\\b[^,]*${ident(column)}`, 'i').test(s),
    )
    const readded = stmts.some(
      (s) =>
        new RegExp(`^ALTER\\s+TABLE\\s+${ident(table)}`, 'i').test(s) &&
        new RegExp(`ADD\\s+COLUMN\\b[^,]*${ident(column)}`, 'i').test(s),
    )
    if (dropped && !readded)
      out.push(`drops generated column ${table}.${column} without re-adding it`)

    // The statement Prisma actually emits, and the one that errors on a
    // generated column after the DROP INDEXes have already gone through.
    const altered = stmts.some(
      (s) =>
        new RegExp(`^ALTER\\s+TABLE\\s+${ident(table)}`, 'i').test(s) &&
        new RegExp(`ALTER\\s+COLUMN\\s+${ident(column)}`, 'i').test(s),
    )
    if (altered) {
      out.push(
        `ALTERs generated column ${table}.${column} — Postgres rejects this, and the ` +
          'statements before it are not rolled back',
      )
    }
  }

  for (const table of PROTECTED_TABLES) {
    if (new RegExp(`DROP\\s+TABLE\\b[^;]*${ident(table)}`, 'i').test(whole)) {
      out.push(`drops table ${table}, which carries a generated search column`)
    }
  }
  for (const fn of PROTECTED_FUNCTIONS) {
    if (new RegExp(`\\bDROP\\s+FUNCTION\\b[^;]*\\b${fn}\\b`, 'i').test(whole)) {
      out.push(`drops function ${fn}(), which a generated column's expression calls`)
    }
  }
  for (const ext of PROTECTED_EXTENSIONS) {
    if (new RegExp(`\\bDROP\\s+EXTENSION\\b[^;]*\\b${ext}\\b`, 'i').test(whole)) {
      out.push(`drops extension ${ext}, which the trigram indexes require`)
    }
  }
  return out
}

let dirs
try {
  dirs = (await readdir(MIGRATIONS, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
} catch (err) {
  console.error(`migration guard: cannot read ${MIGRATIONS}: ${err.message}`)
  process.exit(2)
}

const refused = []
for (const dir of dirs) {
  const file = path.join(MIGRATIONS, dir, 'migration.sql')
  let sql
  try {
    sql = await readFile(file, 'utf8')
  } catch {
    continue // a directory without a migration.sql is not ours to judge
  }
  const problems = findings(sql)
  if (problems.length) refused.push({ dir, problems })
}

if (refused.length) {
  console.error('')
  console.error(
    'migration guard: REFUSING TO APPLY — a migration would destroy search infrastructure',
  )
  console.error('')
  for (const { dir, problems } of refused) {
    console.error(`  ${dir}`)
    for (const p of problems) console.error(`      - ${p}`)
  }
  console.error('')
  console.error('  This is almost certainly a migration generated by `prisma migrate dev`.')
  console.error('  Prisma cannot see GENERATED ALWAYS columns or custom indexes, so it')
  console.error('  proposes dropping them every time. Generate with --create-only, delete')
  console.error('  everything from the SQL except the change you meant, and re-run.')
  console.error('  See README.md, "`prisma migrate dev` will try to drop full-text search".')
  console.error('')
  process.exit(1)
}

console.log(`migration guard: ${dirs.length} migrations checked, no protected drops`)
