import { handle, readJson } from '@/lib/api'
import { createEntry, listEntries } from '@/lib/services/entries'
import { createEntrySchema, entryListSchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const owner = requireIdentity(req).subject
  const p = new URL(req.url).searchParams
  return handle(() =>
    listEntries(
      owner,
      entryListSchema.parse(
        Object.fromEntries(
          // Absent params are dropped rather than passed as null, so each field
          // falls back to its own default instead of failing to coerce.
          ['contactId', 'taskId', 'projectId', 'kind', 'take', 'skip', 'past', 'upcoming']
            .map((k) => [k, p.get(k)] as const)
            .filter(([, v]) => v !== null),
        ),
      ),
    ),
  )
}

export async function POST(req: Request) {
  const owner = requireIdentity(req).subject
  return handle(async () => createEntry(owner, createEntrySchema.parse(await readJson(req))))
}
