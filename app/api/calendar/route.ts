import { handle } from '@/lib/api'
import { getCalendarEvents, rescheduleEvent } from '@/lib/services/calendar'
import { calendarQuerySchema, rescheduleSchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const owner = requireIdentity(req).subject
  const p = new URL(req.url).searchParams
  return handle(async () => {
    const { start, end } = calendarQuerySchema.parse({ start: p.get('start'), end: p.get('end') })
    return getCalendarEvents(owner, start, end)
  })
}

export async function PATCH(req: Request) {
  const owner = requireIdentity(req).subject
  return handle(async () => {
    const { source, entityId, start, end } = rescheduleSchema.parse(await req.json())
    return rescheduleEvent(owner, source, entityId, start, end ?? null)
  })
}
