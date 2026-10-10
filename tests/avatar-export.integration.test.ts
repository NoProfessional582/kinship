import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { prisma } from '@/lib/db'
import { exportArchive, importArchive } from '@/lib/services/archive'
import { ownerTransaction, ownerSnapshot } from '@/lib/owner-lock'
import { ownerUploadDir, uploadUrl, writePhoto } from '@/lib/uploads'
import { purge } from '@/lib/services/trash'
import { createContact, updateContact } from '@/lib/services/contacts'
import { upsertContactSchema } from '@/lib/validation'
import { contend } from './support/owner-contention'

const gate = vi.hoisted(() => ({ beforeRead: undefined as undefined | (() => Promise<void>) }))
vi.mock('@/lib/uploads', async (original) => {
  const actual = await original<typeof import('@/lib/uploads')>()
  return {
    ...actual,
    readPhoto: async (...args: Parameters<typeof actual.readPhoto>) => {
      await gate.beforeRead?.()
      return actual.readPhoto(...args)
    },
  }
})
const OWNER = `avatar-export-${randomUUID()}`
const OTHER = `${OWNER}-other`
const directory = ownerUploadDir(OWNER)
const names = Array.from({ length: 4 }, () => `${randomUUID()}.png`)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const add = (slug: string, avatarUrl: string, deletedAt: Date | null = null) =>
  prisma.contact.create({ data: { owner: OWNER, slug, displayName: slug, avatarUrl, deletedAt } })
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
beforeAll(async () => {
  await mkdir(directory, { recursive: true })
  await mkdir(ownerUploadDir(OTHER), { recursive: true })
  for (const name of names) await writeFile(path.join(directory, name), PNG)
  await writeFile(
    path.join(ownerUploadDir(OTHER), names[0]),
    Buffer.concat([PNG, Buffer.from('other-owner')]),
  )
  await add('live', uploadUrl(names[0]))
  await add('shared-trash', uploadUrl(names[0]), new Date())
  await add('trash', uploadUrl(names[1]), new Date())
  await add('external', 'https://example.test/photo.png')
})
afterAll(async () => {
  gate.beforeRead = undefined
  await prisma.contact.deleteMany({ where: { owner: OWNER } })
  await rm(directory, { recursive: true, force: true })
  await rm(ownerUploadDir(OTHER), { recursive: true, force: true })
  await prisma.$disconnect()
})
describe('reference-aware photo export', () => {
  it('exports live and trashed references once, excludes orphans and external URLs, isolates owners', async () => {
    const archive = await exportArchive(OWNER)
    expect(archive.data.Contact).toHaveLength(4)
    expect(archive.uploads.map((u) => u.name)).toEqual(names.slice(0, 2).sort())
    for (const upload of archive.uploads) expect(Buffer.from(upload.data, 'base64')).toEqual(PNG)
    expect((await readdir(directory)).sort()).toEqual([...names].sort())
  })
  it.each(['missing', 'invalid', 'symlink', 'directory', 'invalid-bytes'])(
    'fails explicitly for %s without altering source',
    async (kind) => {
      const name = `${randomUUID()}.png`
      let url = uploadUrl(name)
      const full = path.join(directory, name)
      if (kind === 'invalid') url = '/uploads/../escape.png'
      if (kind === 'symlink') await symlink(path.join(ownerUploadDir(OTHER), names[0]), full)
      if (kind === 'directory') await mkdir(full)
      if (kind === 'invalid-bytes') await writeFile(full, 'not an image')
      const row = await add(`bad-${kind}`, url)
      try {
        await expect(exportArchive(OWNER)).rejects.toThrow(
          kind === 'invalid' ? /Invalid local photo reference/ : /Could not read referenced photo/,
        )
        expect((await prisma.contact.findUniqueOrThrow({ where: { id: row.id } })).avatarUrl).toBe(
          url,
        )
        expect(await readFile(path.join(directory, names[0]))).toEqual(PNG)
      } finally {
        await prisma.contact.delete({ where: { id: row.id } })
        await rm(full, { recursive: true, force: true })
      }
    },
  )
  it('rejects a symlinked owner directory even with a safe final name', async () => {
    const owner = `${OWNER}-symlink`
    const dir = ownerUploadDir(owner)
    await symlink(directory, dir)
    await prisma.contact.create({
      data: { owner, slug: 'symlink', displayName: 'symlink', avatarUrl: uploadUrl(names[0]) },
    })
    try {
      await expect(exportArchive(owner)).rejects.toThrow(/must not contain symlinks/)
    } finally {
      await prisma.contact.deleteMany({ where: { owner } })
      await rm(dir)
    }
  })
  it('never overwrites immutable photo bytes on a name collision', async () => {
    await expect(
      writePhoto(OWNER, names[0], Buffer.concat([PNG, Buffer.from('replacement')])),
    ).rejects.toThrow(/EEXIST/)
    expect(await readFile(path.join(directory, names[0]))).toEqual(PNG)
  })
  it('keeps reads in one snapshot even when unrelated writers bypass the owner lock', async () => {
    const slug = `snapshot-${randomUUID()}`
    let created: string | undefined
    try {
      await ownerSnapshot(OWNER, async (tx) => {
        expect(await tx.contact.count({ where: { owner: OWNER, slug } })).toBe(0)
        created = (await add(slug, 'https://example.test/photo.png')).id
        expect(await tx.contact.count({ where: { owner: OWNER, slug } })).toBe(0)
      })
      expect(await prisma.contact.count({ where: { owner: OWNER, slug } })).toBe(1)
    } finally {
      if (created) await prisma.contact.delete({ where: { id: created } })
    }
  })
  it('contact reference writers and waiting exports share the real owner lock', async () => {
    const input = upsertContactSchema.parse({
      displayName: 'Coordinated',
      avatarUrl: uploadUrl(names[0]),
    })
    const row = await createContact(OWNER, input)
    try {
      const results = await contend<unknown>(OWNER, [
        () => updateContact(OWNER, row.id, { ...input, avatarUrl: uploadUrl(names[1]) }),
        () => exportArchive(OWNER),
      ])
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
      const archive = await exportArchive(OWNER)
      const contact = archive.data.Contact?.find((r) => r.id === row.id)
      expect(contact?.avatarUrl).toBe(uploadUrl(names[1]))
      expect(archive.uploads.some((u) => uploadUrl(u.name) === contact?.avatarUrl)).toBe(true)
    } finally {
      await prisma.contact.delete({ where: { id: row.id } })
    }
  })
  it('holds the lifecycle lock until captured bytes are read, blocking purge and restore', async () => {
    const captured = deferred(),
      release = deferred()
    let first = true
    gate.beforeRead = async () => {
      if (first) {
        first = false
        captured.resolve()
        await release.promise
      }
    }
    const pendingExport = exportArchive(OWNER)
    await captured.promise
    const row = await prisma.contact.findFirstOrThrow({ where: { owner: OWNER, slug: 'trash' } })
    let purged = false
    const pendingPurge = purge(OWNER, 'contact', row.id).then(() => {
      purged = true
    })
    // A barrier is a real query behind the same cross-process database lock.
    let restored = false
    const pendingRestore = ownerTransaction(OWNER, async () => {
      restored = true
    })
    try {
      const locks = await prisma.$queryRaw<
        { n: bigint }[]
      >`SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND classid = 1936289384 AND NOT granted`
      // Poll actual lock waiters, never infer success from a mocked lock call.
      for (let n = 0; locks[0].n < 2n && n < 100; n++) {
        await new Promise((r) => setTimeout(r, 10))
        locks[0] = (
          await prisma.$queryRaw<
            { n: bigint }[]
          >`SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND classid = 1936289384 AND NOT granted`
        )[0]
      }
      expect(locks[0].n).toBeGreaterThanOrEqual(2n)
      expect(purged).toBe(false)
      expect(restored).toBe(false)
    } finally {
      release.resolve()
      gate.beforeRead = undefined
    }
    const archive = await pendingExport
    await Promise.all([pendingPurge, pendingRestore])
    expect(archive.uploads.map((u) => u.name)).toContain(names[1])
    for (const upload of archive.uploads) expect(Buffer.from(upload.data, 'base64')).toEqual(PNG)
    expect(await prisma.contact.findUnique({ where: { id: row.id } })).toBeNull()
    // Exercise actual import replacement while an export is paused, too.
    const capturedAgain = deferred(),
      releaseAgain = deferred()
    gate.beforeRead = async () => {
      capturedAgain.resolve()
      await releaseAgain.promise
    }
    const exporting = exportArchive(OWNER)
    await capturedAgain.promise
    let imported = false
    const importing = importArchive(OWNER, archive).then(() => {
      imported = true
    })
    try {
      let waiting = false
      for (let n = 0; n < 100 && !waiting; n++) {
        const locks = await prisma.$queryRaw<
          { n: bigint }[]
        >`SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND classid = 1936289384 AND NOT granted`
        waiting = locks[0].n > 0n
        if (!waiting) await new Promise((r) => setTimeout(r, 10))
      }
      expect(waiting).toBe(true)
      expect(imported).toBe(false)
    } finally {
      gate.beforeRead = undefined
      releaseAgain.resolve()
    }
    const before = await exporting
    await importing
    for (const upload of before.uploads) expect(Buffer.from(upload.data, 'base64')).toEqual(PNG)
    const after = await exportArchive(OWNER)
    for (const row of after.data.Contact ?? []) {
      if (typeof row.avatarUrl === 'string' && row.avatarUrl.startsWith('/uploads/'))
        expect(after.uploads.some((u) => uploadUrl(u.name) === row.avatarUrl)).toBe(true)
    }
  }, 15000)
})
