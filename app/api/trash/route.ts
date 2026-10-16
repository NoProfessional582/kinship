import { handle, readJson } from '@/lib/api'
import { ValidationError } from '@/lib/errors'
import { restoreEntry } from '@/lib/services/entries'
import { emptyTrash, listTrash, purge, restore, type TrashKind } from '@/lib/services/trash'
import { trashActionSchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(() => listTrash(requireIdentity(req).subject))
}

export async function POST(req: Request) {
  const owner = requireIdentity(req).subject
  return handle(async () => {
    const body = trashActionSchema.parse(await readJson(req))
    if (body.action === 'empty') return emptyTrash(owner)
    if (!body.kind || !body.id) throw new ValidationError('kind and id are required')
    if (body.action === 'restore') {
      // ⚠️ Entries restore through their own service, not the generic one.
      // `Contact.lastContactAt` is derived from the entries that are LIVE, so
      // bringing one back out of the trash changes the answer for everyone it
      // mentions — exactly as trashing it did. The generic `restore` only flips
      // `deletedAt` and would leave those contacts stuck at the earlier date.
      return body.kind === 'entry'
        ? restoreEntry(owner, body.id)
        : restore(owner, body.kind as TrashKind, body.id)
    }
    return purge(owner, body.kind as TrashKind, body.id, body.deletedAt)
  })
}
