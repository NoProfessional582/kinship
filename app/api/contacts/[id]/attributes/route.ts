import { handle, type RouteCtx } from '@/lib/api'
import { prisma } from '@/lib/db'
import { attributesSchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: RouteCtx) {
  const { id } = await params
  const owner = requireIdentity(req).subject
  return handle(async () => {
    await prisma.contact.findFirstOrThrow({ where: { id, owner }, select: { id: true } })
    return prisma.contactAttribute.findMany({
      where: { contactId: id },
      orderBy: [{ category: 'asc' }, { position: 'asc' }],
    })
  })
}

/** Replaces the whole set: the form always posts the complete list. */
export async function PUT(req: Request, { params }: RouteCtx) {
  const { id } = await params
  const owner = requireIdentity(req).subject
  return handle(async () => {
    const body = attributesSchema.parse(await req.json())
    return prisma.$transaction(async (tx) => {
      await tx.contact.findFirstOrThrow({ where: { id, owner }, select: { id: true } })
      await tx.contactAttribute.deleteMany({ where: { contactId: id } })
      if (body.attributes.length) {
        await tx.contactAttribute.createMany({
          data: body.attributes.map((a, i) => ({
            contactId: id,
            category: a.category.trim() || 'Details',
            key: a.key.trim(),
            value: a.value,
            position: i,
          })),
        })
      }
      return tx.contactAttribute.findMany({
        where: { contactId: id },
        orderBy: [{ category: 'asc' }, { position: 'asc' }],
      })
    })
  })
}
