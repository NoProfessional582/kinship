import { handle } from '@/lib/api'
import { ValidationError } from '@/lib/errors'
import { edgesFor, upsertEdge, type EntityType } from '@/lib/services/edges'
import { edgeSchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const owner = requireIdentity(req).subject
  const p = new URL(req.url).searchParams
  const type = (p.get('type') ?? 'contact') as EntityType
  const id = p.get('id') ?? ''
  return handle(() => edgesFor(owner, type, id))
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
