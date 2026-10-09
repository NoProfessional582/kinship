import { handle } from '@/lib/api'
import { createTask, getBoard } from '@/lib/services/tasks'
import { upsertTaskSchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const owner = requireIdentity(req).subject
  const projectId = new URL(req.url).searchParams.get('projectId')
  return handle(() => getBoard(owner, projectId))
}

export async function POST(req: Request) {
  const owner = requireIdentity(req).subject
  return handle(async () => createTask(owner, upsertTaskSchema.parse(await req.json())))
}
