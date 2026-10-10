import { handle } from '@/lib/api'
import { ValidationError } from '@/lib/errors'
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
  return handle(async () => {
    const body = edgeSchema.parse(await req.json())
    if (body.sourceType === body.targetType && body.sourceId === body.targetId) {
      throw new ValidationError('An entity cannot relate to itself')
    }
    return upsertEdge(owner, body)
  })
}
