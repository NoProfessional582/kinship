import { handle } from '@/lib/api'
import { createProject, listProjects } from '@/lib/services/projects'
import { upsertProjectSchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(() => listProjects(requireIdentity(req).subject))
}

export async function POST(req: Request) {
  const owner = requireIdentity(req).subject
  return handle(async () => createProject(owner, upsertProjectSchema.parse(await req.json())))
}
