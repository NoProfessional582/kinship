import { found, handle, type RouteCtx } from '@/lib/api'
import { deleteContact, getContactDossier, updateContact } from '@/lib/services/contacts'
import { upsertContactSchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: RouteCtx) {
  const { id } = await params
  return handle(async () => found(await getContactDossier(requireIdentity(req).subject, id)))
}

export async function PATCH(req: Request, { params }: RouteCtx) {
  const owner = requireIdentity(req).subject
  const { id } = await params
  return handle(async () => updateContact(owner, id, upsertContactSchema.parse(await req.json())))
}

export async function DELETE(req: Request, { params }: RouteCtx) {
  const { id } = await params
  return handle(() => deleteContact(requireIdentity(req).subject, id))
}
