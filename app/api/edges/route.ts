import { handle, readJson } from '@/lib/api'
import { edgesFor, upsertEdge } from '@/lib/services/edges'
import { edgeListSchema, edgeSchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const owner = requireIdentity(req).subject
  const p = new URL(req.url).searchParams
  return handle(async () => {
    const { type, id } = edgeListSchema.parse({
      type: p.get('type') ?? undefined,
      id: p.get('id') ?? '',
    })
    return edgesFor(owner, type, id)
  })
}

export async function POST(req: Request) {
  const owner = requireIdentity(req).subject
  return handle(async () => upsertEdge(owner, edgeSchema.parse(await readJson(req))))
}
