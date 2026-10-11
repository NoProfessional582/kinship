import { handle } from '@/lib/api'
import { parseGraphQuery } from '@/lib/graph/focus'
import { requireIdentity } from '@/lib/identity'
import { getGraph } from '@/lib/services/graph'

export const dynamic = 'force-dynamic'

/** The 3D map's graph (docs/api/graph.openapi.json). Read-only. */
export async function GET(req: Request) {
  const owner = requireIdentity(req).subject
  const response = await handle(async () =>
    getGraph(owner, parseGraphQuery(new URL(req.url).searchParams)),
  )
  // One owner's records: no shared cache may keep them.
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
