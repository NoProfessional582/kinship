import type { Prisma } from '@prisma/client'
import { prisma } from '../db'

type Db = typeof prisma | Prisma.TransactionClient

/**
 * Rebuild `Contact.lastContactAt` from the entries that currently support it.
 *
 * The column is wholly derived. Nothing lets a person set it by hand, and its
 * definition is exactly: **the most recent entry mentioning this contact that
 * is live and has already happened.** So this function never adjusts the old
 * number — it re-reads the definition, which can only produce a truthful value.
 *
 * ⚠️ IT LIVES IN ITS OWN MODULE BECAUSE THREE DIFFERENT EVENTS CHANGE ITS
 * ANSWER, and they are spread across two services that cannot import each
 * other. `entries.ts` already imports `trash.ts`, so putting this in either one
 * and reaching for it from the other would be a cycle.
 *
 * The three events, and why each needs it:
 *
 *   * **An edit retracts a mention** (K14). The evidence behind that person's
 *     recency is withdrawn, so the honest value is whatever the remaining
 *     entries say — which may be EARLIER, or null.
 *   * **An entry is trashed.** Same retraction, for every contact it mentions.
 *     This was MISSING until 2026-09-12: `deleteEntry` soft-deleted and stopped,
 *     so a contact kept a recency sourced from an entry that no longer exists,
 *     and the check-in rail stayed quiet about someone the app had no record of
 *     you meeting.
 *   * **A trashed entry is restored.** The symmetric case, and the reason the
 *     trash fix cannot be half-done: recomputing on delete without recomputing
 *     on restore would leave the contact permanently stuck at the earlier date,
 *     which is worse than the bug being fixed.
 *
 * ⚠️ Purge deliberately does NOT call this. A purge is only reachable for a row
 * already in the trash, and the `deletedAt: null` filter below has therefore
 * already excluded that entry. Calling it again would be a no-op that implies
 * purge is load-bearing for recency, and it is not.
 *
 * Deliberately asymmetric with `createEntry`, which only ever moves the value
 * FORWARD. Re-dating an entry is a statement about when something happened and
 * other entries may still support the current recency; withdrawing an entry is
 * a statement that the evidence is gone.
 */
export async function recomputeLastContact(
  db: Db,
  owner: string,
  contactIds: string[],
): Promise<void> {
  if (!contactIds.length) return
  const now = new Date()
  for (const contactId of contactIds) {
    const latest = await (db as any).entry.findFirst({
      where: {
        owner,
        deletedAt: null,
        occurredAt: { lte: now },
        mentions: { some: { contactId } },
      },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    })
    await (db as any).contact.updateMany({
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
  const rows = await (db as any).mention.findMany({
    where: { entryId, entry: { owner } },
    select: { contactId: true },
  })
  return rows.map((r: { contactId: string }) => r.contactId)
}
