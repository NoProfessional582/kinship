import { handle } from '@/lib/api'
import { contactsNeedingAttention } from '@/lib/services/cadence'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(() => contactsNeedingAttention(requireIdentity(req).subject))
}
