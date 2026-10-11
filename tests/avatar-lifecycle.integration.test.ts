import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID, createHash } from 'node:crypto'
import { readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/db'
import { ownerTransaction } from '@/lib/owner-lock'
import {
  collectPhotos,
  photoInventory,
  PHOTO_GRACE_MS,
  PENDING_PHOTO_MS,
  recordRemovedPhotos,
  removeAttemptPhotos,
  validatePhotoSave,
  writePendingPhoto,
} from '@/lib/photo-lifecycle'
import { ownerUploadDir, uploadUrl, writePhoto } from '@/lib/uploads'
import { createContact, updateContact } from '@/lib/services/contacts'
import { softDelete, restore, purge, emptyTrash } from '@/lib/services/trash'
import { exportArchive, importArchive } from '@/lib/services/archive'
import { upsertContactSchema } from '@/lib/validation'
import { contend } from './support/owner-contention'

const fault = vi.hoisted(() => ({
  unlink: false,
  journal: false,
  beforeUnlink: undefined as undefined | (() => Promise<void>),
}))
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return {
    ...actual,
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      if (String(args[0]).endsWith('.png')) await fault.beforeUnlink?.()
      if (fault.unlink && String(args[0]).endsWith('.png'))
        throw new Error('injected image unlink failure')
      return actual.unlink(...args)
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (fault.journal) throw new Error('injected journal failure')
      return actual.rename(...args)
    },
  }
})
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const owners: string[] = []
const owner = () => {
  const id = `lifecycle-${randomUUID()}`
  owners.push(id)
  return id
}
const name = () => `${randomUUID()}.png`
const input = (avatarUrl: string | null = null) =>
  upsertContactSchema.parse({ displayName: 'Photo person', avatarUrl })
const upload = (who: string, file: string, now = Date.now()) =>
  ownerTransaction(who, async () => writePendingPhoto(who, file, PNG, now))
const candidate = (who: string, file: string, now = Date.now()) =>
  ownerTransaction(who, async () => recordRemovedPhotos(who, [file], now))
const bytes = (who: string, file: string) => readFile(path.join(ownerUploadDir(who), file))
const imageExists = async (who: string, file: string) =>
  (await readdir(ownerUploadDir(who))).includes(file)
const fingerprint = async (who: string) => ({
  rows: await prisma.contact.findMany({ where: { owner: who }, orderBy: { id: 'asc' } }),
  files: await Promise.all(
    (await readdir(ownerUploadDir(who))).sort().map(async (file) => {
      // lstat inventory covers symlinks separately; fingerprint only plain fixture files.
      return [
        file,
        createHash('sha256')
          .update(await readFile(path.join(ownerUploadDir(who), file)))
          .digest('hex'),
      ]
    }),
  ),
})
afterEach(() => {
  fault.unlink = false
  fault.journal = false
  fault.beforeUnlink = undefined
  vi.restoreAllMocks()
})
afterAll(async () => {
  for (const who of owners) {
    await prisma.contact.deleteMany({ where: { owner: who } })
    await rm(ownerUploadDir(who), { recursive: true, force: true })
  }
  await prisma.$disconnect()
})

describe('new-operation photo lifecycle', () => {
  it('replaces and clears photos after grace while protecting shared and legacy bytes', async () => {
    const who = owner(),
      first = name(),
      second = name(),
      legacy = name()
    for (const file of [first, second, legacy]) await writePhoto(who, file, PNG)
    const a = await createContact(who, input(uploadUrl(first)))
    const b = await createContact(who, input(uploadUrl(first)))
    await updateContact(who, a.id, input(uploadUrl(second)))
    expect(await collectPhotos(who, Date.now() + PHOTO_GRACE_MS)).toEqual({ removed: [] })
    await updateContact(who, b.id, input())
    expect(await imageExists(who, first)).toBe(true)
    expect((await collectPhotos(who, Date.now() + PHOTO_GRACE_MS)).removed).toEqual([first])
    await updateContact(who, a.id, input())
    expect((await collectPhotos(who, Date.now() + PHOTO_GRACE_MS)).removed).toEqual([second])
    expect(await bytes(who, legacy)).toEqual(PNG)
  })
  it('soft delete and restore retain bytes; last-reference purge and empty trash record candidates', async () => {
    const who = owner(),
      file = name()
    await writePhoto(who, file, PNG)
    const a = await createContact(who, input(uploadUrl(file)))
    const b = await createContact(who, input(uploadUrl(file)))
    await softDelete(who, 'contact', a.id)
    await restore(who, 'contact', a.id)
    await softDelete(who, 'contact', a.id)
    await purge(who, 'contact', a.id)
    expect((await photoInventory(who)).files[0].candidateAfter).toBe(null)
    await softDelete(who, 'contact', b.id)
    await emptyTrash(who)
    expect((await collectPhotos(who, Date.now() + PHOTO_GRACE_MS)).removed).toEqual([file])
  })
  it('pending uploads protect cancelled tabs for seven days and expire at the exact boundary', async () => {
    const who = owner(),
      file = name(),
      now = Date.now()
    await upload(who, file, now)
    expect((await collectPhotos(who, now + PENDING_PHOTO_MS - 1)).removed).toEqual([])
    await expect(
      ownerTransaction(who, (tx) =>
        validatePhotoSave(tx, who, uploadUrl(file), now + PENDING_PHOTO_MS),
      ),
    ).rejects.toThrow(/expired/)
    expect(await prisma.contact.count({ where: { owner: who } })).toBe(0)
    expect((await collectPhotos(who, now + PENDING_PHOTO_MS)).removed).toEqual([file])
    await expect(createContact(who, input(uploadUrl(file)))).rejects.toThrow(
      /Could not read referenced photo/,
    )
  })
  it('active shared references remain saveable after pending expiry', async () => {
    const who = owner(),
      file = name()
    await upload(who, file, Date.now() - PENDING_PHOTO_MS + 10000)
    const a = await createContact(who, input(uploadUrl(file)))
    await ownerTransaction(who, (tx) =>
      validatePhotoSave(tx, who, uploadUrl(file), Date.now() + PENDING_PHOTO_MS),
    )
    await softDelete(who, 'contact', a.id)
    expect((await collectPhotos(who, Date.now() + PENDING_PHOTO_MS)).removed).toEqual([])
    expect(await bytes(who, file)).toEqual(PNG)
  })
  it('failed database saves retain pending bytes until expiry', async () => {
    const who = owner(),
      file = name(),
      now = Date.now()
    await upload(who, file, now)
    await expect(updateContact(who, randomUUID(), input(uploadUrl(file)))).rejects.toThrow()
    expect(await bytes(who, file)).toEqual(PNG)
    expect((await collectPhotos(who, now + PENDING_PHOTO_MS)).removed).toEqual([file])
  })
  it('candidate grace renews after reuse and another successful removal', async () => {
    const who = owner(),
      file = name()
    await writePhoto(who, file, PNG)
    await candidate(who, file, Date.now() - PHOTO_GRACE_MS - 1000)
    const row = await createContact(who, input(uploadUrl(file)))
    await updateContact(who, row.id, input())
    const report = await photoInventory(who)
    expect(report.files[0].candidateAfter).toBeGreaterThan(Date.now())
    expect(await bytes(who, file)).toEqual(PNG)
  })
  it('rollback journals cannot authorize deleting the surviving database reference', async () => {
    const who = owner(),
      file = name()
    await writePhoto(who, file, PNG)
    const row = await createContact(who, input(uploadUrl(file)))
    await expect(
      ownerTransaction(who, async (tx) => {
        await tx.contact.delete({ where: { id: row.id } })
        await recordRemovedPhotos(who, [file], Date.now() - PHOTO_GRACE_MS)
        throw new Error('crash before commit')
      }),
    ).rejects.toThrow(/crash before commit/)
    expect((await collectPhotos(who)).removed).toEqual([])
    expect(await bytes(who, file)).toEqual(PNG)
  })
  it('filesystem deletion failure preserves committed rows and is retryable from persisted journals', async () => {
    const who = owner(),
      file = name()
    await upload(who, file, Date.now() - PENDING_PHOTO_MS)
    fault.unlink = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await collectPhotos(who)).removed).toEqual([])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Collection failed'),
      file,
      expect.any(Error),
    )
    expect(await bytes(who, file)).toEqual(PNG)
    fault.unlink = false
    expect((await collectPhotos(who)).removed).toEqual([file])
  })
  it('journal failure does not roll back a committed clear and never sweeps its untracked photo', async () => {
    const who = owner(),
      file = name()
    await writePhoto(who, file, PNG)
    const row = await createContact(who, input(uploadUrl(file)))
    fault.journal = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const updated = await updateContact(who, row.id, input())
    expect(updated.avatarUrl).toBe(null)
    expect(warn).toHaveBeenCalled()
    fault.journal = false
    expect((await collectPhotos(who, Date.now() + PHOTO_GRACE_MS)).removed).toEqual([])
    expect(await bytes(who, file)).toEqual(PNG)
  })
  it('rejects missing, unsafe and symlink local save URLs without changing the row', async () => {
    const who = owner(),
      other = owner(),
      file = name()
    await writePhoto(other, file, PNG)
    const row = await createContact(who, input())
    // Ensure the owner directory exists without assigning its legacy bytes.
    await writePhoto(who, name(), PNG)
    await symlink(path.join(ownerUploadDir(other), file), path.join(ownerUploadDir(who), file))
    for (const url of [uploadUrl(name()), '/uploads/../bad.png', uploadUrl(file)])
      await expect(updateContact(who, row.id, input(url))).rejects.toThrow()
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: row.id } })).avatarUrl).toBe(null)
    expect(await bytes(other, file)).toEqual(PNG)
  })
  it('retains unsafe journals and image symlinks, preserving owner isolation', async () => {
    const who = owner(),
      other = owner(),
      file = name(),
      invalid = name()
    await writePhoto(other, file, PNG)
    await writePhoto(who, invalid, PNG)
    await writeFile(path.join(ownerUploadDir(who), `.pending-${invalid}.json`), '{}')
    await symlink(path.join(ownerUploadDir(other), file), path.join(ownerUploadDir(who), file))
    await candidate(who, file, Date.now() - PHOTO_GRACE_MS)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await collectPhotos(who)).removed).toEqual([])
    expect(warn).toHaveBeenCalled()
    const report = await photoInventory(who)
    expect(report.unsafe.map((f) => f.name)).toEqual(
      expect.arrayContaining([file, invalid, `.pending-${invalid}.json`]),
    )
    expect(await bytes(other, file)).toEqual(PNG)
  })
  it('inventory reports exact bytes, age, trash/shared references and pending state without mutation', async () => {
    const who = owner(),
      file = name(),
      legacy = name(),
      pending = name(),
      now = Date.now()
    await writePhoto(who, file, PNG)
    await writePhoto(who, legacy, PNG)
    await upload(who, pending, now)
    const a = await createContact(who, input(uploadUrl(file)))
    await createContact(who, input(uploadUrl(file)))
    await softDelete(who, 'contact', a.id)
    for (const n of [file, legacy, pending])
      await utimes(path.join(ownerUploadDir(who), n), new Date(now - 10000), new Date(now - 10000))
    const before = await fingerprint(who)
    const report = await photoInventory(who, now)
    expect(report.totals).toEqual({
      files: 3,
      bytes: 3 * PNG.length,
      orphans: 2,
      orphanBytes: 2 * PNG.length,
      eligible: 0,
      unsafe: 0,
    })
    expect(report.scannedAt).toBe(new Date(now).toISOString())
    expect(report.files.every((f) => Math.abs(f.ageMs - 10000) < 1)).toBe(true)
    expect(
      report.files
        .find((f) => f.name === file)
        ?.references.map((r) => r.trashed)
        .sort(),
    ).toEqual([false, true])
    expect(report.files.find((f) => f.name === legacy)?.candidateAfter).toBe(null)
    expect(report.files.find((f) => f.name === pending)?.pendingUntil).toBe(now + PENDING_PHOTO_MS)
    expect(await fingerprint(who)).toEqual(before)
  })
  it('save, export, import and upload contend with cleanup without dangling committed references', async () => {
    const who = owner(),
      file = name(),
      now = Date.now()
    await upload(who, file, now)
    const row = await createContact(who, input(uploadUrl(file)))
    const archive = await exportArchive(who)
    const fresh = name()
    const results = await contend<unknown>(who, [
      () => updateContact(who, row.id, input(uploadUrl(file))),
      () => exportArchive(who),
      () => importArchive(who, archive),
      () => upload(who, fresh),
      () => collectPhotos(who, now + PENDING_PHOTO_MS),
    ])
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    const exported = await exportArchive(who)
    expect(exported.data.Contact?.[0].avatarUrl).toBe(uploadUrl(file))
    expect(exported.uploads[0].data).toBe(PNG.toString('base64'))
  })
  it('expired unassigned save racing cleanup either fails safely or leaves verified referenced bytes', async () => {
    const who = owner(),
      file = name()
    await upload(who, file, Date.now() - PENDING_PHOTO_MS)
    const results = await contend<unknown>(who, [
      () => createContact(who, input(uploadUrl(file))),
      () => collectPhotos(who),
    ])
    expect(results[0].status).toBe('rejected')
    expect(results[1].status).toBe('fulfilled')
    expect(await prisma.contact.count({ where: { owner: who } })).toBe(0)
    expect(await imageExists(who, file)).toBe(false)
  })
  it('interrupted collection after image removal recovers remaining journals without touching legacy bytes', async () => {
    const who = owner(),
      file = name(),
      legacy = name()
    await upload(who, file, Date.now() - PENDING_PHOTO_MS)
    await writePhoto(who, legacy, PNG)
    await rm(path.join(ownerUploadDir(who), file)) // Simulated crash after unlink, before journal removal.
    expect((await collectPhotos(who)).removed).toEqual([])
    expect(await readdir(ownerUploadDir(who))).toEqual([legacy])
    expect(await bytes(who, legacy)).toEqual(PNG)
  })
  it('holds the deletion session lock until a delayed filesystem call finishes', async () => {
    const who = owner(),
      file = name()
    await writePhoto(who, file, PNG)
    await candidate(who, file, Date.now() - PHOTO_GRACE_MS)
    let entered!: () => void, release!: () => void
    const held = new Promise<void>((resolve) => {
      entered = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    fault.beforeUnlink = async () => {
      entered()
      await released
    }
    const collection = collectPhotos(who)
    await held
    const save = createContact(who, input(uploadUrl(file)))
    // Attach rejection handling immediately, then observe PostgreSQL blocking
    // the actual save on the dedicated collector's session advisory lock.
    const outcome = Promise.allSettled([save])
    try {
      const deadline = Date.now() + 3000
      while (true) {
        const [row] = await prisma.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_locks
          WHERE locktype = 'advisory' AND classid = 1936289384
            AND objid::bigint = (hashtext(${who})::bigint & 4294967295)
            AND NOT granted`
        if (row.n) break
        if (Date.now() >= deadline) throw new Error('Save never waited for deletion lock')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(await bytes(who, file)).toEqual(PNG)
    } finally {
      release()
    }
    expect((await collection).removed).toEqual([file])
    expect((await outcome)[0].status).toBe('rejected')
    expect(await prisma.contact.count({ where: { owner: who } })).toBe(0)
  })
  it('reports a symlinked owner directory without following or mutating it', async () => {
    const who = owner(),
      other = owner(),
      file = name()
    await writePhoto(other, file, PNG)
    await symlink(ownerUploadDir(other), ownerUploadDir(who))
    const report = await photoInventory(who)
    expect(report.files).toEqual([])
    expect(report.unsafe).toEqual([
      { name: '<owner-directory>', reason: expect.stringContaining('must not contain symlinks') },
    ])
    expect(await bytes(other, file)).toEqual(PNG)
  })
  it('an assigned upload cannot expire-delete after a later candidate journal failure', async () => {
    const who = owner(),
      file = name(),
      now = Date.now()
    await upload(who, file, now)
    const row = await createContact(who, input(uploadUrl(file)))
    fault.journal = true
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await updateContact(who, row.id, input())).avatarUrl).toBe(null)
    fault.journal = false
    expect((await collectPhotos(who, now + PENDING_PHOTO_MS + PHOTO_GRACE_MS)).removed).toEqual([])
    const report = await photoInventory(who, now + PENDING_PHOTO_MS)
    expect(report.files[0]).toMatchObject({
      pendingAssigned: true,
      eligible: false,
      referenced: false,
    })
    expect(await bytes(who, file)).toEqual(PNG)
  })
  it('failed restore deletion journals only attempt-owned bytes and protects concurrent reuse', async () => {
    const who = owner(),
      attempted = name(),
      reused = name(),
      legacy = name()
    for (const file of [attempted, reused, legacy]) await writePhoto(who, file, PNG)
    await createContact(who, input(uploadUrl(reused)))
    fault.unlink = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await removeAttemptPhotos(who, [attempted, reused])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not remove attempt-owned'),
      attempted,
      expect.any(Error),
    )
    fault.unlink = false
    const report = await photoInventory(who)
    expect(report.files.find((f) => f.name === attempted)?.candidateAfter).not.toBe(null)
    expect(report.files.find((f) => f.name === reused)?.candidateAfter).toBe(null)
    expect((await collectPhotos(who, Date.now() + PHOTO_GRACE_MS)).removed).toEqual([attempted])
    expect(await bytes(who, reused)).toEqual(PNG)
    expect(await bytes(who, legacy)).toEqual(PNG)
  })
  it('reuse invalidates an old candidate before a later removal journal can fail', async () => {
    const who = owner(),
      file = name()
    await writePhoto(who, file, PNG)
    await candidate(who, file, Date.now() - PHOTO_GRACE_MS - 1000)
    const row = await createContact(who, input(uploadUrl(file)))
    expect((await photoInventory(who)).files[0].candidateAfter).toBe(null)
    fault.journal = true
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await updateContact(who, row.id, input())).avatarUrl).toBe(null)
    fault.journal = false
    expect((await collectPhotos(who, Date.now() + PHOTO_GRACE_MS)).removed).toEqual([])
    expect(await bytes(who, file)).toEqual(PNG)
  })
})
