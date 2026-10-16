import { found, handle, readJson, type RouteCtx } from '@/lib/api'
import { deleteProject, getProject, updateProject } from '@/lib/services/projects'
import { upsertProjectSchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: RouteCtx) {
  const { id } = await params
  return handle(async () => found(await getProject(requireIdentity(req).subject, id)))
}

export async function PATCH(req: Request, { params }: RouteCtx) {
  const owner = requireIdentity(req).subject
  const { id } = await params
  return handle(async () =>
    updateProject(owner, id, upsertProjectSchema.parse(await readJson(req))),
  )
}

export async function DELETE(req: Request, { params }: RouteCtx) {
  const { id } = await params
  return handle(() => deleteProject(requireIdentity(req).subject, id))
}
