import type { Prisma } from '@prisma/client'
import { prisma } from '../db'

type Db = typeof prisma | Prisma.TransactionClient

/** Latest live, already-happened owned entry mentioning each affected contact.
 * Call after source changes, inside an ownerTransaction (or locked import).
 */
export async function recomputeLastContact(
  db: Db,
  owner: string,
  contactIds: string[],
): Promise<void> {
  if (!contactIds.length) return
  const now = new Date()
  for (const contactId of [...new Set(contactIds)].sort()) {
    const latest = await db.entry.findFirst({
      where: {
        owner,
        deletedAt: null,
        occurredAt: { lte: now },
        mentions: { some: { contactId } },
      },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    })
    await db.contact.updateMany({
      where: { id: contactId, owner },
      data: { lastContactAt: latest?.occurredAt ?? null },
    })
  }
}

/** Every contact an entry currently mentions. The input to a recompute. */
export async function contactsMentionedBy(
  db: Db,
  owner: string,
  entryId: string,
): Promise<string[]> {
  const rows = await db.mention.findMany({
    where: { entryId, entry: { owner } },
    select: { contactId: true },
  })
  return rows.map((r) => r.contactId)
}
