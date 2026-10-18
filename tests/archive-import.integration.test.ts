import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import {
  importArchive as importOwnedArchive,
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
} from '@/lib/services/archive'

/**
 * Archive import safety (K07).
 *
 * Every case here is a REJECTED or ROLLED-BACK import, which is also what makes
 * the suite safe to run: a successful import truncates every table, and a
 * failing one rolls that truncate back with everything else. Nothing below ever
 * commits.
 */
const MARK = `__archtest_${Date.now()}__`
const OWNER = `${MARK}owner`
const importArchive = (archive: unknown) => importOwnedArchive(OWNER, archive)

const archiveWith = (data: Record<string, Record<string, unknown>[]>, extra = {}) => ({
  format: ARCHIVE_FORMAT,
  version: ARCHIVE_VERSION,
  migrations: [] as string[],
  data,
  ...extra,
})

// Two rows sharing a slug: the unique index rejects the second, so the
// transaction fails AFTER the truncate — the exact window K07 is about.
const DUPLICATE_SLUGS = {
  Contact: [
    { id: `${MARK}c1`, slug: `${MARK}dup`, displayName: `${MARK}One` },
    { id: `${MARK}c2`, slug: `${MARK}dup`, displayName: `${MARK}Two` },
  ],
}

afterAll(async () => {
  await prisma.$disconnect()
})

describe('import — a failed import must not destroy live data (K07)', () => {
  it('leaves the database untouched when a row fails', async () => {
    const contactsBefore = await prisma.contact.count()

    await expect(importArchive(archiveWith(DUPLICATE_SLUGS))).rejects.toThrow()

    // The rollback took the truncate with it.
    expect(await prisma.contact.count()).toBe(contactsBefore)
  })

  it('ignores the photos an older archive carries, rather than refusing it', async () => {
    const contactsBefore = await prisma.contact.count()
    const legacy = archiveWith(
      {
        Contact: DUPLICATE_SLUGS.Contact.map((c) => ({ ...c, avatarUrl: '/uploads/a.png' })),
      },
      { uploads: [{ name: 'a.png', data: 'AAAA' }] },
    )

    // Fails on the duplicate slug, not on the photo fields: those are dropped.
    await expect(importArchive(legacy)).rejects.toThrow(/unique|slug/i)
    expect(await prisma.contact.count()).toBe(contactsBefore)
  })
})

it('rejects cyclic archives before replacing rows', async () => {
  const before = await prisma.contact.count()
  const raw = archiveWith({
    Task: [
      { id: 'cycle-a', parentTaskId: 'cycle-b' },
      { id: 'cycle-b', parentTaskId: 'cycle-a' },
    ],
  })
  await expect(importArchive(raw)).rejects.toThrow(/cycle/)
  expect(await prisma.contact.count()).toBe(before)
})
