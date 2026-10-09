import { handle } from '@/lib/api'
import { prisma } from '@/lib/db'
import { ensureColumns } from '@/lib/services/board'
import { upsertColumnSchema } from '@/lib/validation'
import { STEP } from '@/lib/fractional-index'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const owner = requireIdentity(req).subject
  return handle(() => ensureColumns(prisma as any, owner))
}

export async function POST(req: Request) {
  const owner = requireIdentity(req).subject
  return handle(async () => {
    const body = upsertColumnSchema.parse(await req.json())
    const last = await prisma.boardColumn.findFirst({
      where: { owner, projectId: null },
      orderBy: { position: 'desc' },
      select: { position: true },
    })
    return prisma.boardColumn.create({
      data: {
        owner,
        name: body.name,
        color: body.color ?? null,
        wipLimit: body.wipLimit ?? null,
        status: body.status,
        position: last ? last.position + STEP : STEP,
      },
    })
  })
}
