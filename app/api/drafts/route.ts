import { handle } from '@/lib/api'
import { listDrafts } from '@/lib/services/tasks'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(() => listDrafts(requireIdentity(req).subject))
}
