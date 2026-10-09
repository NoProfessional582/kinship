import { handle } from '@/lib/api'
import { prisma } from '@/lib/db'
import { settingsSchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'

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
    const body = settingsSchema.parse(await req.json())
    // Only the keys actually sent are written, so a partial save from one panel
    // never clears a field owned by another.
    const data = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as any
    return prisma.settings.upsert({
      where: { owner },
      create: { owner, ...data },
      update: data,
      select: FIELDS,
    })
  })
}
