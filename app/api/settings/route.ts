import { handle, readJson } from '@/lib/api'
import { prisma } from '@/lib/db'
import { settingsSchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'
import { AGENT_ACCESS_APP_ONLY, agentAccess } from '@/lib/agent-access'
import { ForbiddenError } from '@/lib/errors'
import { hasBrowserProvenance } from '@/lib/request-security'

export const dynamic = 'force-dynamic'

const FIELDS = {
  timezone: true,
  userName: true,
  appTitle: true,
  tagline: true,
  weatherEnabled: true,
  weatherLocation: true,
  weatherUnit: true,
  calendarWeekStart: true,
  fontScale: true,
  defaultCadence: true,
  agentAccess: true,
} as const

export async function GET(req: Request) {
  const owner = requireIdentity(req).subject
  return handle(async () => {
    // `owner` is unique, so concurrent first loads converge on one row.
    return prisma.settings.upsert({
      where: { owner },
      create: { owner },
      update: {},
      select: FIELDS,
    })
  })
}

export async function PATCH(req: Request) {
  const owner = requireIdentity(req).subject
  return handle(async () => {
    const body = settingsSchema.parse(await readJson(req))
    // Read-only agent access would mean little if an agent could switch it back
    // with one HTTP call, so changing it needs the browser provenance only the
    // app's own pages send. Resending the current value (the phone form saves
    // every field) and every other setting stay open to curl.
    if (body.agentAccess !== undefined && !hasBrowserProvenance(req)) {
      const current = await agentAccess(owner)
      if (body.agentAccess !== current) throw new ForbiddenError(AGENT_ACCESS_APP_ONLY)
    }
    // Only the keys actually sent are written, so a partial save from one panel
    // never clears a field owned by another: zod leaves absent keys out, and
    // Prisma leaves a field it is given as undefined untouched.
    const data = body
    return prisma.settings.upsert({
      where: { owner },
      create: { owner, ...data },
      update: data,
      select: FIELDS,
    })
  })
}
