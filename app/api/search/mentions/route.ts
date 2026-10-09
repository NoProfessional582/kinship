import { handle } from '@/lib/api'
import { searchMentions } from '@/lib/services/search'
import { mentionSearchSchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const owner = requireIdentity(req).subject
  const p = new URL(req.url).searchParams
  return handle(async () => {
    const { type, q } = mentionSearchSchema.parse({
      type: p.get('type') ?? 'contact',
      q: p.get('q') ?? '',
    })
    return searchMentions(owner, type, q)
  })
}
