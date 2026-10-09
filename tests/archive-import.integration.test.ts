import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/db'
import { importArchive as importOwnedArchive, ARCHIVE_FORMAT, ARCHIVE_VERSION } from '@/lib/services/archive'
import { ownerUploadDir } from '@/lib/uploads'

/**
 * Archive import safety (K07, K08).
 *
 * Every case here is a REJECTED or ROLLED-BACK import, which is also what makes
 * the suite safe to run: a successful import truncates every table, and a
 * failing one rolls that truncate back with everything else. Nothing below ever
 * commits.
 */
const MARK = `__archtest_${Date.now()}__`
const OWNER = `${MARK}owner`
const UPLOAD_DIR = ownerUploadDir(OWNER)
const importArchive = (archive: unknown) => importOwnedArchive(OWNER, archive)

// Smallest valid payloads per type. The PNG pair differ in their bytes so a
// collision is detectable, not just a same-size overwrite.
const PNG_A = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const PNG_B = Buffer.concat([PNG_A, Buffer.from('DIFFERENT-BYTES-MARKER')])
const HTML = Buffer.from('<html><script>alert(1)</script></html>')
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
const BAD_MAGIC = Buffer.from('NOTANIMAGE' + 'x'.repeat(40))

const VICTIM = `${MARK}victim.png`

const archiveWith = (uploads: { name: string; data: string }[], rows?: Record<string, unknown>[]) => ({
  format: ARCHIVE_FORMAT,
  version: ARCHIVE_VERSION,
  migrations: [] as string[],
  // Two rows sharing a slug: the unique index rejects the second, so the
  // transaction fails AFTER the truncate — the exact window K07 is about.
  data: {
    Contact: rows ?? [
      { id: `${MARK}c1`, slug: `${MARK}dup`, displayName: `${MARK}One` },
      { id: `${MARK}c2`, slug: `${MARK}dup`, displayName: `${MARK}Two` },
    ],
  },
  uploads,
})

const listUploads = () => readdir(UPLOAD_DIR).catch(() => [] as string[])

beforeAll(async () => {
  await mkdir(UPLOAD_DIR, { recursive: true })
  await writeFile(path.join(UPLOAD_DIR, VICTIM), PNG_A)
})

afterAll(async () => {
  // The whole folder belongs to this run's test owner, including any upload an
  // import under test wrote with a name of its own choosing.
  await rm(UPLOAD_DIR, { recursive: true, force: true })
  await prisma.$disconnect()
})

describe('import — a failed import must not destroy live assets (K07)', () => {
  it('leaves the original bytes and the database untouched when a row fails', async () => {
    const contactsBefore = await prisma.contact.count()
    const before = await readFile(path.join(UPLOAD_DIR, VICTIM))
    expect(before.equals(PNG_A)).toBe(true)

    // The archive carries a file with the SAME NAME and different bytes. Before
    // K07 this was written over the live file before the transaction ran.
    await expect(
      importArchive(archiveWith([{ name: VICTIM, data: PNG_B.toString('base64') }])),
    ).rejects.toThrow()

    const after = await readFile(path.join(UPLOAD_DIR, VICTIM))
    expect(after.equals(PNG_A)).toBe(true)
    expect(after.equals(PNG_B)).toBe(false)

    // The rollback took the truncate with it.
    expect(await prisma.contact.count()).toBe(contactsBefore)
  })

  it('cleans up the files it staged, leaving the directory as it found it', async () => {
    const before = (await listUploads()).sort()

    await expect(
      importArchive(archiveWith([{ name: `${MARK}new.png`, data: PNG_A.toString('base64') }])),
    ).rejects.toThrow()

    expect((await listUploads()).sort()).toEqual(before)
  })
})

describe('import — only raster images reach the public origin (K08)', () => {
  const hostile: [string, Buffer][] = [
    ['an HTML document', HTML],
    ['an SVG document', SVG],
    ['a file with invalid magic bytes', BAD_MAGIC],
  ]

  for (const [label, payload] of hostile) {
    it(`rejects ${label} before any public file is written`, async () => {
      const before = (await listUploads()).sort()

      await expect(
        importArchive(archiveWith([{ name: `${MARK}evil.png`, data: payload.toString('base64') }])),
      ).rejects.toThrow(/not an image this app accepts/)

      // "Before any public file is written" is the property, so the directory
      // must be byte-for-byte the same set it was.
      expect((await listUploads()).sort()).toEqual(before)
    })
  }

  it('rejects the whole archive when only one entry among several is hostile', async () => {
    const before = (await listUploads()).sort()

    await expect(
      importArchive(
        archiveWith([
          { name: `${MARK}ok1.png`, data: PNG_A.toString('base64') },
          { name: `${MARK}ok2.png`, data: PNG_A.toString('base64') },
          { name: `${MARK}evil.png`, data: HTML.toString('base64') },
        ]),
      ),
    ).rejects.toThrow(/not an image this app accepts/)

    // Crucially the two good ones must NOT have been written either.
    expect((await listUploads()).sort()).toEqual(before)
  })

  it('an archive naming a file .png is still judged on its bytes', async () => {
    await expect(
      importArchive(archiveWith([{ name: `${MARK}looks-fine.png`, data: HTML.toString('base64') }])),
    ).rejects.toThrow(/not an image this app accepts/)
  })
})
