import { prisma } from '../db'
import { cadenceHealth, type Cadence } from '../cadence'

export * from '../cadence'

/** Contacts that have drifted past their intended rhythm, worst first. */
export async function contactsNeedingAttention(owner: string, limit = 8) {
  const contacts = await prisma.contact.findMany({
    where: { owner, deletedAt: null, cadence: { not: 'NONE' } },
    select: {
      id: true,
      slug: true,
      displayName: true,
      avatarUrl: true,
      cadence: true,
      tier: true,
      lastContactAt: true,
    },
  })

  return contacts
    .map((c) => ({ ...c, health: cadenceHealth(c.cadence as Cadence, c.lastContactAt) }))
    .filter((c) => ['overdue', 'due', 'never'].includes(c.health.state))
    .sort((a, b) => {
      // Never-contacted first, then the most overdue.
      if (a.health.state === 'never' && b.health.state !== 'never') return -1
      if (b.health.state === 'never' && a.health.state !== 'never') return 1
      return (a.health.dueInDays ?? 0) - (b.health.dueInDays ?? 0)
    })
    .slice(0, limit)
}
