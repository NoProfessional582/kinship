import { handle, readJson } from '@/lib/api'
import { prisma } from '@/lib/db'
import { reorderColumnsSchema } from '@/lib/validation'
import { STEP } from '@/lib/fractional-index'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request) {
  const owner = requireIdentity(req).subject
  return handle(async () => {
    const body = reorderColumnsSchema.parse(await readJson(req))
    await prisma.$transaction(
      body.columnIds.map((id, i) =>
        prisma.boardColumn.updateMany({ where: { id, owner }, data: { position: (i + 1) * STEP } }),
      ),
    )
    return prisma.boardColumn.findMany({
      where: { owner, projectId: null },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    })
  })
}
