import { prisma } from '../db'
import { normalizeLabel } from '../utils'

type Tx = Omit<
  typeof prisma,
  '$transaction' | '$connect' | '$disconnect' | '$on' | '$use' | '$extends'
>

/**
 * Resolves tags by name and returns their ids, preserving input order.
 *
 * Matching is case-insensitive, because the chip inputs that feed this already
 * treat "Work" and "work" as one tag within a single list. Upserting on the
 * exact name let the two diverge as soon as they were typed on different
 * records, so #work and #Work ended up as separate tags filtering separately.
 * The first spelling to be saved is the one kept.
 */
export async function resolveTagIds(tx: Tx, owner: string, names: string[]): Promise<string[]> {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    const key = normalizeLabel(name)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(name)
  }

  if (unique.length === 0) return []

  // One round trip for the whole list. The old loop ran a findFirst and a create
  // per tag, so ten tags on an entry meant twenty awaited queries inside the
  // save transaction.
  const byKey = new Map<string, string>()
  const lookup = async (names: string[]) => {
    const rows = await tx.tag.findMany({
      where: {
        owner,
        OR: names.map((name) => ({ name: { equals: name, mode: 'insensitive' as const } })),
      },
      select: { id: true, name: true },
    })
    for (const row of rows) byKey.set(normalizeLabel(row.name), row.id)
  }

  await lookup(unique)
  const missing = unique.filter((name) => !byKey.has(normalizeLabel(name)))

  if (missing.length > 0) {
    // `skipDuplicates` is ON CONFLICT DO NOTHING, so it covers every unique
    // constraint on the table — including the index on the normalized name.
    // Two concurrent saves of "#work" and "#Work" used to both miss the lookup
    // and both insert: identical spellings raised a P2002 that aborted an
    // otherwise valid save, and spellings differing only in case slipped past
    // the plain unique index and created the two divergent tags this function
    // exists to prevent. Now the loser of the race simply reads the winner's
    // row back.
    await tx.tag.createMany({
      data: missing.map((name) => ({ owner, name })),
      skipDuplicates: true,
    })
    await lookup(missing)
  }

  return unique.map((name) => byKey.get(normalizeLabel(name))).filter((id): id is string => !!id)
}
