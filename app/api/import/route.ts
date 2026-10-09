import { handle } from '@/lib/api'
import { ValidationError } from '@/lib/errors'
import { MAX_ARCHIVE_BYTES, readTextCapped } from '@/lib/body-limit'
import { importArchive } from '@/lib/services/archive'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Restores an archive over this database, replacing everything in it.
 *
 * The body is the archive itself and nothing else, so a file on disk can be
 * pushed straight up:
 *
 *   curl -X POST 'http://localhost:2002/api/import?confirm=replace' \
 *        -H 'Content-Type: application/json' --data-binary @kb-archive-….json
 *
 * `confirm=replace` is required regardless: this app has no sign-in, so the
 * only thing between a stray POST and every row in the database is that the
 * caller had to spell out what it was asking for. `force=1` additionally
 * waives the check that both sides are on the same migration.
 */
export async function POST(req: Request) {
  const owner = requireIdentity(req).subject
  return handle(async () => {
    const params = new URL(req.url).searchParams
    if (params.get('confirm') !== 'replace') {
      throw new ValidationError(
        'Importing replaces every row in this database. Re-send with ?confirm=replace to proceed.',
      )
    }

    // Parsed here rather than with `req.json()` so a truncated or non-JSON file
    // comes back as "that file is not JSON" instead of a framework-shaped 500.
    //
    // ⚠️ Capped, and read as a stream. `req.text()` held the entire archive as
    // a string before anything had looked at it, and `JSON.parse` then built a
    // second, larger structure from it. The cap is ~20x the real archive
    // (0.45 MiB for 205 contacts across 19 tables), and an oversized body now
    // says so — 413 — instead of arriving truncated and being reported as
    // corrupt JSON. See lib/body-limit.ts for why it sits just under Next's own
    // 10MB truncation rather than at it.
    const raw = await readTextCapped(req, MAX_ARCHIVE_BYTES)
    let archive: unknown
    try {
      archive = JSON.parse(raw)
    } catch {
      throw new ValidationError('That file is not JSON.')
    }

    return importArchive(owner, archive, { force: params.get('force') === '1' })
  })
}
