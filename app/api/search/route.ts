import { handle } from '@/lib/api'
import { globalSearch } from '@/lib/services/search'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const owner = requireIdentity(req).subject
  const q = new URL(req.url).searchParams.get('q') ?? ''
  return handle(() => globalSearch(owner, q))
}
