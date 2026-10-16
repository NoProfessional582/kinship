import { found, handle, readJson, type RouteCtx } from '@/lib/api'
import { deleteTask, getTask, updateTask } from '@/lib/services/tasks'
import { upsertTaskSchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: RouteCtx) {
  const { id } = await params
  return handle(async () => found(await getTask(requireIdentity(req).subject, id)))
}

export async function PATCH(req: Request, { params }: RouteCtx) {
  const owner = requireIdentity(req).subject
  const { id } = await params
  return handle(async () => updateTask(owner, id, upsertTaskSchema.parse(await readJson(req))))
}

export async function DELETE(req: Request, { params }: RouteCtx) {
  const { id } = await params
  return handle(() => deleteTask(requireIdentity(req).subject, id))
}
