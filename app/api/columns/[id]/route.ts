import { handle, type RouteCtx } from '@/lib/api'
import { deleteColumn, updateColumn } from '@/lib/services/board'
import { upsertColumnSchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: RouteCtx) {
  const owner = requireIdentity(req).subject
  const { id } = await params
  return handle(async () => {
    const body = upsertColumnSchema.partial().parse(await req.json())
    return updateColumn(owner, id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.color !== undefined ? { color: body.color ?? null } : {}),
      ...(body.wipLimit !== undefined ? { wipLimit: body.wipLimit ?? null } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    })
  })
}

export async function DELETE(req: Request, { params }: RouteCtx) {
  const { id } = await params
  return handle(() => deleteColumn(requireIdentity(req).subject, id))
}
