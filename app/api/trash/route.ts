import { handle, readJson } from '@/lib/api'
import { ValidationError } from '@/lib/errors'
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
      // Restoring an entry also recomputes the recency of everyone it mentions
      // (`Contact.lastContactAt`); `restore` does that for every kind it is given.
      return restore(owner, body.kind as TrashKind, body.id)
    }
    return purge(owner, body.kind as TrashKind, body.id, body.deletedAt)
  })
}
