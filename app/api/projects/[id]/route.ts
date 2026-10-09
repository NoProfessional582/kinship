import { handle, type RouteCtx } from '@/lib/api'
import { deleteProject, getProject, updateProject } from '@/lib/services/projects'
import { upsertProjectSchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: RouteCtx) {
  const { id } = await params
  return handle(() => getProject(requireIdentity(req).subject, id))
}

export async function PATCH(req: Request, { params }: RouteCtx) {
  const owner = requireIdentity(req).subject
  const { id } = await params
  return handle(async () => updateProject(owner, id, upsertProjectSchema.parse(await req.json())))
}

export async function DELETE(req: Request, { params }: RouteCtx) {
  const { id } = await params
  return handle(() => deleteProject(requireIdentity(req).subject, id))
}
