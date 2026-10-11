import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile, symlink } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/db'
import {
  exportArchive,
  importArchive,
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
} from '@/lib/services/archive'
import { ownerUploadDir, uploadUrl, STORED_NAME } from '@/lib/uploads'
import { contend } from './support/owner-contention'

const fault = vi.hoisted(() => ({ writes: 0, failAt: 0, partial: false }))
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args)
      if (args[1] === 'wx' && fault.partial) {
        const write = file.writeFile.bind(file)
        file.writeFile = async () => {
          await write(PNG.subarray(0, 12))
          throw new Error('injected partial filesystem write')
        }
      }
      return file
    },
  }
})
vi.mock('@/lib/uploads', async (original) => {
  const actual = await original<typeof import('@/lib/uploads')>()
  return {
    ...actual,
    writePhoto: async (...args: Parameters<typeof actual.writePhoto>) => {
      if (++fault.writes === fault.failAt) throw new Error('injected staging write failure')
      return actual.writePhoto(...args)
    },
  }
})
const owners: string[] = []
const owner = () => {
  const value = `restore-${randomUUID()}`
  owners.push(value)
  return value
}
const name = () => `${randomUUID()}.png`
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const OTHER = Buffer.concat([PNG, Buffer.from('different')])
const archive = (names: string[], bytes = names.map(() => PNG)) => ({
  format: ARCHIVE_FORMAT,
  version: ARCHIVE_VERSION,
  migrations: [],
  data: {
    Contact: names.map((file, i) => ({
      id: randomUUID(),
      slug: `photo-${i}`,
      displayName: `Photo ${i}`,
      avatarUrl: uploadUrl(file),
      deletedAt: i ? new Date().toISOString() : null,
    })),
  },
  uploads: names.map((file, i) => ({ name: file, data: bytes[i].toString('base64') })),
})
const imageNames = async (who: string) =>
  (await readdir(ownerUploadDir(who)).catch(() => [] as string[]))
    .filter((n) => STORED_NAME.test(n))
    .sort()
const fingerprint = async (who: string) => ({
  rows: (await exportArchive(who)).data,
  files: await Promise.all(
    (await imageNames(who)).map(async (n) => [
      n,
      createHash('sha256')
        .update(await readFile(path.join(ownerUploadDir(who), n)))
        .digest('hex'),
    ]),
  ),
})
const put = async (who: string, file: string, bytes = PNG) => {
  await mkdir(ownerUploadDir(who), { recursive: true })
  await writeFile(path.join(ownerUploadDir(who), file), bytes)
}
afterEach(() => {
  fault.partial = false
  fault.failAt = 0
  fault.writes = 0
})
afterAll(async () => {
  for (const who of owners) {
    await prisma.contact.deleteMany({ where: { owner: who } })
    await rm(ownerUploadDir(who), { recursive: true, force: true })
  }
  await prisma.$disconnect()
})
describe('byte-verified idempotent restore', () => {
  it('reuses original/shared/trashed bytes across repeated original restores and export cycles', async () => {
    const who = owner(),
      file = name()
    await put(who, file)
    const input = archive([file, file])
    for (let i = 0; i < 3; i++) {
      expect((await importArchive(who, input)).uploads).toBe(1)
      const exported = await exportArchive(who)
      expect(exported.data.Contact?.map((r) => r.avatarUrl)).toEqual([
        uploadUrl(file),
        uploadUrl(file),
      ])
      expect(exported.data.Contact?.filter((r) => r.deletedAt)).toHaveLength(1)
      await importArchive(who, exported)
      expect(await imageNames(who)).toEqual([file])
      expect(await readFile(path.join(ownerUploadDir(who), file))).toEqual(PNG)
    }
  })
  it('preserves same-name different bytes and journals only the superseded prior reference', async () => {
    const who = owner(),
      file = name()
    await put(who, file)
    await prisma.contact.create({
      data: { owner: who, slug: 'old', displayName: 'Old', avatarUrl: uploadUrl(file) },
    })
    const input = archive([file], [OTHER])
    await importArchive(who, input)
    const exported = await exportArchive(who)
    expect(exported.uploads[0].name).not.toBe(file)
    expect(await readFile(path.join(ownerUploadDir(who), file))).toEqual(PNG)
    const journal = JSON.parse(
      await readFile(path.join(ownerUploadDir(who), `.candidate-${file}.json`), 'utf8'),
    )
    expect(journal.name).toBe(file)
    expect(journal.reason).toBe('restore')
    await importArchive(who, input)
    expect(await imageNames(who)).toHaveLength(2)
  })
  it('collapses equal bytes with different names and ignores validated legacy orphan payloads', async () => {
    const who = owner(),
      a = name(),
      b = name(),
      orphan = name()
    const input = archive([a, b])
    input.uploads.push({ name: orphan, data: OTHER.toString('base64') })
    expect((await importArchive(who, input)).uploads).toBe(2)
    expect(await imageNames(who)).toHaveLength(1)
    const exported = await exportArchive(who)
    expect(exported.uploads).toHaveLength(1)
    expect(new Set(exported.data.Contact?.map((r) => r.avatarUrl)).size).toBe(1)
    input.uploads[2].data = Buffer.from('<html/>').toString('base64')
    const before = await fingerprint(who)
    await expect(importArchive(who, input)).rejects.toThrow(/not an image/)
    expect(await fingerprint(who)).toEqual(before)
  })
  it('does not reuse another owner or symlink bytes', async () => {
    const who = owner(),
      other = owner(),
      file = name()
    await put(other, file)
    await mkdir(ownerUploadDir(who), { recursive: true })
    await symlink(path.join(ownerUploadDir(other), file), path.join(ownerUploadDir(who), file))
    await importArchive(who, archive([file]))
    const exported = await exportArchive(who)
    expect(exported.uploads[0].name).not.toBe(file)
    expect(await readFile(path.join(ownerUploadDir(other), file))).toEqual(PNG)
  })
  it('rolls back partial staging, preserving rows and reused files', async () => {
    const who = owner(),
      file = name()
    await put(who, file)
    await importArchive(who, archive([file]))
    const before = await fingerprint(who)
    const input = archive(
      [file, name(), name()],
      [PNG, OTHER, Buffer.concat([OTHER, Buffer.from('third')])],
    )
    fault.writes = 0
    fault.failAt = 2
    await expect(importArchive(who, input)).rejects.toThrow(/injected staging/)
    expect(await fingerprint(who)).toEqual(before)
  })
  it('removes its exclusively created file when the filesystem write fails partway through', async () => {
    const who = owner(),
      file = name()
    await put(who, file)
    await importArchive(who, archive([file]))
    const before = await fingerprint(who)
    fault.partial = true
    await expect(importArchive(who, archive([name()], [OTHER]))).rejects.toThrow(
      /partial filesystem write/,
    )
    expect(await fingerprint(who)).toEqual(before)
  })
  it('rolls back failed rows after staging and reuse', async () => {
    const who = owner(),
      file = name()
    await put(who, file)
    await importArchive(who, archive([file]))
    const before = await fingerprint(who)
    const input = archive([file, name()], [PNG, OTHER])
    input.data.Contact[1].slug = input.data.Contact[0].slug
    await expect(importArchive(who, input)).rejects.toThrow()
    expect(await fingerprint(who)).toEqual(before)
  })
  it('serializes concurrent successful restores without duplicate writes', async () => {
    const who = owner(),
      input = archive([name(), name()], [PNG, OTHER])
    const outcomes = await contend(who, [
      () => importArchive(who, input),
      () => importArchive(who, input),
    ])
    expect(outcomes.every((r) => r.status === 'fulfilled')).toBe(true)
    expect(await imageNames(who)).toHaveLength(2)
    expect((await exportArchive(who)).uploads.map((u) => u.data).sort()).toEqual(
      input.uploads.map((u) => u.data).sort(),
    )
  })
  it('rejects missing references and ambiguous duplicate archive names before mutation', async () => {
    const who = owner(),
      input = archive([name()])
    await importArchive(who, input)
    const before = await fingerprint(who)
    input.uploads.push({ name: input.uploads[0].name, data: OTHER.toString('base64') })
    await expect(importArchive(who, input)).rejects.toThrow(/conflicting/)
    input.uploads = []
    await expect(importArchive(who, input)).rejects.toThrow(/missing referenced/)
    expect(await fingerprint(who)).toEqual(before)
  })
})
