import { handle, type RouteCtx } from '@/lib/api'
import { moveTask } from '@/lib/services/tasks'
import { moveTaskSchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: RouteCtx) {
  const owner = requireIdentity(req).subject
  const { id } = await params
  return handle(async () => {
    const body = moveTaskSchema.parse(await req.json())
    return moveTask(owner, id, body.columnId, body.toIndex, body.projectId, body.beforeId, body.afterId)
  })
}
