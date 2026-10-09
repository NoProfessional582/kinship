import { handle, type RouteCtx } from '@/lib/api'
import { deleteEdge } from '@/lib/services/edges'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function DELETE(req: Request, { params }: RouteCtx) {
  const { id } = await params
  return handle(() => deleteEdge(requireIdentity(req).subject, id))
}
