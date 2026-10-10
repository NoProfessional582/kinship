import 'dotenv/config'
import { prisma } from '../lib/db'
import {
  archiveFilename,
  currentCounts,
  exportArchive,
  importArchive,
  type Archive,
} from '../lib/services/archive'
import { requireConfiguredOwner } from '../lib/identity'

/**
 * Command-line half of the archive, for moving this app between machines.
 *
 *   npm run export > kinship-archive.json                  # this machine, to a file
 *   npm run import < kinship-archive.json                  # dry run: says what it would do
 *   npm run import -- --replace < kinship-archive.json     # actually does it
 *
 * The archive travels on stdout and stdin rather than through a path argument.
 * A path would be a path *inside the container*, which is a trap, and anything
 * this script wrote to a bind mount would land root-owned — the container runs
 * as root because the builder stage is the only image with tsx. Redirecting on
 * the host sidesteps both: your shell creates the file, so you own it.
 *
 * Everything conversational goes to stderr, so stdout is only ever the archive.
 */

const say = (...args: unknown[]) => console.error(...args)
const owner = requireConfiguredOwner()

const USAGE = `Usage:
  npm run export > kinship-archive.json
  npm run import [-- --replace] [--force] < kinship-archive.json

  --replace   Actually restore. Without it, import only reports the plan.
  --force     Restore even if the archive and this database are on different
              migrations. Columns added since the export will take their
              defaults; columns dropped since are discarded.`

async function main() {
  const [command, ...flags] = process.argv.slice(2)

  if (command === 'export') return runExport()
  if (command === 'import') {
    return runImport({
      replace: flags.includes('--replace'),
      force: flags.includes('--force'),
    })
  }

  say(USAGE)
  process.exitCode = 2
}

async function runExport() {
  const archive = await exportArchive(owner)
  const body = JSON.stringify(archive, null, 2)
  process.stdout.write(body)

  const total = Object.values(archive.counts).reduce((a, b) => a + b, 0)
  say(
    `Exported ${total} rows and ${archive.uploads.length} upload(s), ` +
      `${(Buffer.byteLength(body) / 1024 / 1024).toFixed(2)} MB. ` +
      `Suggested name: ${archiveFilename(new Date(archive.exportedAt))}`,
  )
  say(summarise(archive.counts))
}

async function runImport({ replace, force }: { replace: boolean; force: boolean }) {
  if (process.stdin.isTTY) {
    say('Nothing on stdin. Pipe an archive in:\n')
    say(USAGE)
    process.exitCode = 2
    return
  }

  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')

  if (!raw.trim()) {
    say('Nothing on stdin — did the redirect find the file?')
    process.exitCode = 2
    return
  }

  // Unchecked until importArchive validates it; the dry run only reads it for
  // display, and every field it reads has a fallback.
  let archive: Partial<Archive>
  try {
    archive = JSON.parse(raw)
  } catch (err) {
    say(`That is not JSON: ${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
    return
  }

  if (!replace) {
    // A dry run is worth more than a confirmation prompt here: the interesting
    // question is not "are you sure" but "what exactly is on each side".
    const here = await currentCounts(owner)
    say(
      `Archive written ${archive.exportedAt ?? 'at an unrecorded time'}, format v${archive.version}.`,
    )
    say('\nIt would REPLACE this database:\n')
    say(compare(here, archive.counts ?? {}))
    say(`\nUploads in the archive: ${archive.uploads?.length ?? 0}`)
    say('\nNothing was changed. Re-run with `-- --replace` to restore it.')
    return
  }

  const result = await importArchive(owner, archive, { force })
  const total = Object.values(result.counts).reduce((a, b) => a + b, 0)
  say(`Restored ${total} rows and ${result.uploads} upload(s).`)
  if (result.schemaDrift) {
    say(
      `Schema differed and --force was given. Not applied here: ` +
        `${result.schemaDrift.missing.join(', ') || 'none'}; ` +
        `extra here: ${result.schemaDrift.extra.join(', ') || 'none'}.`,
    )
  }
  say(summarise(result.counts))
}

const summarise = (counts: Record<string, number>) =>
  Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([model, n]) => `  ${model.padEnd(18)} ${n}`)
    .join('\n')

const compare = (here: Record<string, number>, incoming: Record<string, number>) =>
  [...new Set([...Object.keys(here), ...Object.keys(incoming)])]
    .filter((m) => (here[m] ?? 0) > 0 || (incoming[m] ?? 0) > 0)
    .map((m) => `  ${m.padEnd(18)} ${String(here[m] ?? 0).padStart(6)}  ->  ${incoming[m] ?? 0}`)
    .join('\n')

main()
  .catch((err) => {
    say(`\n${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
