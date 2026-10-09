import { handle, type RouteCtx } from '@/lib/api'
import { deleteEntry, getEntry, updateEntry } from '@/lib/services/entries'
import { updateEntrySchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: RouteCtx) {
  const { id } = await params
  return handle(() => getEntry(requireIdentity(req).subject, id))
}

export async function PATCH(req: Request, { params }: RouteCtx) {
  const owner = requireIdentity(req).subject
  const { id } = await params
  return handle(async () => updateEntry(owner, id, updateEntrySchema.parse(await req.json())))
}

export async function DELETE(req: Request, { params }: RouteCtx) {
  const { id } = await params
  return handle(() => deleteEntry(requireIdentity(req).subject, id))
}
