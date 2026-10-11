import path from 'node:path'
import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { lstat, open, readdir, rename, unlink } from 'node:fs/promises'
import { prisma, type Tx } from './db'
import { ownerCollection, ownerTransaction } from './owner-lock'
import { ValidationError } from './errors'
import { MAX_UPLOAD_BYTES } from './body-limit'
import {
  checkedDirectory,
  localPhotoName,
  ownerUploadDir,
  photoPath,
  readPhoto,
  STORED_NAME,
  writePhoto,
} from './uploads'

// Persisted timestamps, rather than process timers, survive restarts. A tab may
// retain an upload for seven days; removed references get a further day of grace.
export const PENDING_PHOTO_MS = 7 * 24 * 60 * 60 * 1000
export const PHOTO_GRACE_MS = 24 * 60 * 60 * 1000
const markerPath = (owner: string, kind: 'pending' | 'candidate', name: string) => {
  photoPath(owner, name)
  return path.join(ownerUploadDir(owner), `.${kind}-${name}.json`)
}

type Marker = { name: string; recordedAt: number; reason: string; assigned?: boolean }
async function marker(owner: string, kind: 'pending' | 'candidate', name: string) {
  let file
  try {
    await checkedDirectory(owner)
    file = await open(
      markerPath(owner, kind, name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > 1024) throw new Error('Unsafe photo journal')
    const value = JSON.parse(await file.readFile('utf8')) as Marker
    if (
      value.name !== name ||
      !Number.isSafeInteger(value.recordedAt) ||
      value.recordedAt < 0 ||
      (value.assigned !== undefined && typeof value.assigned !== 'boolean') ||
      (kind === 'pending'
        ? value.reason !== 'upload'
        : !['restore', 'reference-removed'].includes(value.reason))
    )
      throw new Error('Invalid photo journal')
    return value
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  } finally {
    await file?.close()
  }
}

async function journal(
  owner: string,
  kind: 'pending' | 'candidate',
  name: string,
  reason: string,
  now: number,
  assigned = false,
) {
  await checkedDirectory(owner, true)
  const previous = await marker(owner, kind, name)
  if (previous && kind === 'pending' && (!assigned || previous.assigned)) return
  const target = markerPath(owner, kind, name)
  const temporary = `${target}.tmp-${randomUUID()}`
  const file = await open(temporary, 'wx')
  try {
    await file.writeFile(
      JSON.stringify({
        name,
        reason,
        recordedAt:
          kind === 'pending'
            ? (previous?.recordedAt ?? now)
            : Math.max(now, previous?.recordedAt ?? 0),
        ...(kind === 'pending' ? { assigned } : {}),
      }),
    )
    await file.sync()
    await file.close()
    await rename(temporary, target)
    const directory = await open(
      ownerUploadDir(owner),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } finally {
    await file.close().catch(() => {})
    await unlink(temporary).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err
    })
  }
}

export async function photoReferences(tx: Tx, owner: string): Promise<Set<string>> {
  const rows = await tx.contact.findMany({ where: { owner }, select: { avatarUrl: true } })
  const names = new Set<string>()
  for (const row of rows) {
    const name = localPhotoName(row.avatarUrl)
    if (name) names.add(name)
  }
  return names
}

/** Called inside the same owner transaction as the reference write. */
export async function validatePhotoSave(tx: Tx, owner: string, url: unknown, now = Date.now()) {
  const name = localPhotoName(url)
  if (!name) return
  await readPhoto(owner, name, MAX_UPLOAD_BYTES)
  const pending = await marker(owner, 'pending', name)
  if (
    pending &&
    now >= pending.recordedAt + PENDING_PHOTO_MS &&
    !(await photoReferences(tx, owner)).has(name)
  )
    throw new ValidationError(
      'That photo upload has expired. Upload the photo again before saving.',
    )
}

/** Journal first: a crash after image creation still leaves known provenance. */
export async function writePendingPhoto(
  owner: string,
  name: string,
  bytes: Buffer,
  now = Date.now(),
) {
  await journal(owner, 'pending', name, 'upload', now)
  await writePhoto(owner, name, bytes)
}

/** A rollback may leave candidates; all references are rechecked before removal. */
export async function recordRemovedPhotos(
  owner: string,
  names: Iterable<string>,
  now = Date.now(),
  reason: 'restore' | 'reference-removed' = 'reference-removed',
) {
  for (const name of names) {
    await journal(owner, 'candidate', name, reason, now).catch((err) =>
      console.warn('[photos] Candidate journal failed; retaining photo', name, err),
    )
  }
}

/** Reuse cancels old candidates. Once an upload participates in a successful row write, its pending journal
 * can no longer authorize expiry collection by itself. Persist this before DB
 * commit: candidate-journal failure on a later clear must retain the image. A
 * failed commit can conservatively leave an assigned orphan, never data loss. */
export async function protectReferencedPhotos(tx: Tx, owner: string) {
  const rows = await tx.contact.findMany({ where: { owner }, select: { avatarUrl: true } })
  for (const row of rows) {
    let name: string | null
    try {
      name = localPhotoName(row.avatarUrl)
    } catch {
      continue
    }
    if (!name) continue
    const pending = await marker(owner, 'pending', name)
    if (pending && !pending.assigned)
      await journal(owner, 'pending', name, 'upload', pending.recordedAt, true)
    // A prior removal record must not authorize collection after this new use.
    // Invalidate before commit; failed commits may retain an orphan, safely.
    if (await marker(owner, 'candidate', name)) {
      await unlink(markerPath(owner, 'candidate', name))
      const directory = await open(
        ownerUploadDir(owner),
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      )
      try {
        await directory.sync()
      } finally {
        await directory.close()
      }
    }
  }
}

async function eligibility(owner: string, name: string, referenced: boolean, now: number) {
  const pending = await marker(owner, 'pending', name)
  const candidate = await marker(owner, 'candidate', name)
  const pendingUntil = pending ? pending.recordedAt + PENDING_PHOTO_MS : null
  const candidateAfter = candidate ? candidate.recordedAt + PHOTO_GRACE_MS : null
  return {
    referenced,
    pendingUntil,
    pendingAssigned: pending?.assigned ?? false,
    candidateAfter,
    eligible:
      !referenced &&
      (!!(pending && !pending.assigned) || candidateAfter !== null) &&
      (pendingUntil === null || now >= pendingUntil) &&
      (candidateAfter === null || now >= candidateAfter),
  }
}

/** Candidate/pending journals only. Never discovers legacy images for deletion. */
export async function collectPhotos(owner: string, now = Date.now()) {
  return ownerCollection(owner, async (checkLock) => {
    const references = await photoReferences(prisma, owner)
    let entries: string[]
    try {
      await checkedDirectory(owner)
      entries = await readdir(ownerUploadDir(owner))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { removed: [] as string[] }
      throw err
    }
    const names = new Set<string>()
    for (const entry of entries) {
      const match = /^\.(?:pending|candidate)-(.+)\.json$/.exec(entry)
      if (match && STORED_NAME.test(match[1])) names.add(match[1])
    }
    const removed: string[] = []
    for (const name of [...names].sort()) {
      try {
        const state = await eligibility(owner, name, references.has(name), now)
        if (!state.eligible) continue
        const target = photoPath(owner, name)
        // Reject symlinks, directories and malformed image bytes. Keeping the
        // journals until after unlink makes interrupted collection retryable.
        let exists = true
        try {
          await lstat(target)
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
          exists = false
        }
        if (exists) {
          await readPhoto(owner, name, MAX_UPLOAD_BYTES)
          await checkLock()
          await unlink(target)
          removed.push(name)
        }
        for (const kind of ['candidate', 'pending'] as const)
          await unlink(markerPath(owner, kind, name)).catch((err: NodeJS.ErrnoException) => {
            if (err.code !== 'ENOENT') throw err
          })
      } catch (err) {
        console.warn('[photos] Collection failed; remaining journals retained for retry', name, err)
      }
    }
    return { removed }
  })
}

/** Failed restores may remove only their exclusively created, still-unreferenced
 * files. Use the same non-expiring deletion guard as ordinary collection. */
export async function removeAttemptPhotos(owner: string, created: Iterable<string>) {
  return ownerCollection(owner, async (checkLock) => {
    const referenced = await photoReferences(prisma, owner)
    for (const name of created) {
      if (referenced.has(name)) continue
      try {
        await checkedDirectory(owner)
        try {
          await lstat(photoPath(owner, name))
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw err
        }
        await readPhoto(owner, name, MAX_UPLOAD_BYTES)
        await checkLock()
        await unlink(photoPath(owner, name))
      } catch (err) {
        await recordRemovedPhotos(owner, [name], Date.now(), 'restore')
        console.warn(
          '[photos] Could not remove attempt-owned restore photo; retained for retry',
          name,
          err,
        )
      }
    }
  })
}

/** A filesystem failure cannot report an already committed save as rolled back. */
export async function collectPhotosAfterCommit(owner: string) {
  await collectPhotos(owner).catch((err) =>
    console.warn('[photos] Deferred collection failed', err),
  )
}

/** Capture only references actually removed by this operation. Journal before
 * commit closes the crash gap; a failed commit is safe because collection checks
 * all live AND trashed rows. No candidate is deleted inside this transaction. */
export async function photoTransaction<T>(owner: string, work: (tx: Tx) => Promise<T>) {
  const result = await ownerTransaction(owner, async (tx) => {
    // Invalid legacy references are protected, without blocking unrelated edits.
    const before = await tx.contact.findMany({ where: { owner }, select: { avatarUrl: true } })
    const result = await work(tx)
    await protectReferencedPhotos(tx, owner)
    const after = new Set(
      (await tx.contact.findMany({ where: { owner }, select: { avatarUrl: true } })).map(
        (r) => r.avatarUrl,
      ),
    )
    const removed = new Set<string>()
    for (const row of before) {
      if (after.has(row.avatarUrl)) continue
      try {
        const name = localPhotoName(row.avatarUrl)
        if (name) removed.add(name)
      } catch {
        /* Protect invalid legacy paths. */
      }
    }
    await recordRemovedPhotos(owner, removed)
    return result
  })
  await collectPhotosAfterCommit(owner)
  return result
}

/** Owner-scoped snapshot. Reads no symlink targets and never writes journals. */
export async function photoInventory(owner: string, now = Date.now()) {
  return ownerTransaction(owner, async (tx) => {
    const rows = await tx.contact.findMany({
      where: { owner },
      select: { id: true, avatarUrl: true, deletedAt: true },
    })
    const refs = new Map<string, { id: string; trashed: boolean }[]>()
    const invalidReferences: { id: string; avatarUrl: string | null }[] = []
    for (const row of rows) {
      try {
        const name = localPhotoName(row.avatarUrl)
        if (name)
          refs.set(name, [
            ...(refs.get(name) ?? []),
            { id: row.id, trashed: row.deletedAt !== null },
          ])
      } catch {
        invalidReferences.push({ id: row.id, avatarUrl: row.avatarUrl })
      }
    }
    const files = [] as {
      name: string
      bytes: number
      ageMs: number
      references: { id: string; trashed: boolean }[]
      referenced: boolean
      pendingUntil: number | null
      pendingAssigned: boolean
      candidateAfter: number | null
      eligible: boolean
    }[]
    const unsafe: { name: string; reason: string }[] = []
    let entries: string[] = []
    try {
      await checkedDirectory(owner)
      entries = await readdir(ownerUploadDir(owner))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
        unsafe.push({
          name: '<owner-directory>',
          reason: err instanceof Error ? err.message : 'Unsafe owner directory',
        })
    }
    for (const name of entries.sort()) {
      const match = /^\.(pending|candidate)-(.+)\.json$/.exec(name)
      if (match && STORED_NAME.test(match[2])) {
        try {
          await marker(owner, match[1] as 'pending' | 'candidate', match[2])
        } catch (err) {
          unsafe.push({ name, reason: err instanceof Error ? err.message : 'Unsafe journal' })
        }
        continue
      }
      if (!STORED_NAME.test(name)) {
        unsafe.push({ name, reason: 'Unknown filename' })
        continue
      }
      try {
        const stat = await lstat(photoPath(owner, name))
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Not a regular file')
        await readPhoto(owner, name, MAX_UPLOAD_BYTES)
        const state = await eligibility(owner, name, refs.has(name), now)
        files.push({
          name,
          bytes: stat.size,
          ageMs: Math.max(0, now - stat.mtimeMs),
          references: refs.get(name) ?? [],
          ...state,
        })
      } catch (err) {
        unsafe.push({ name, reason: err instanceof Error ? err.message : 'Unsafe file' })
      }
    }
    const orphaned = files.filter((file) => !file.referenced)
    return {
      scannedAt: new Date(now).toISOString(),
      files,
      unsafe,
      invalidReferences,
      missingReferences: [...refs.keys()].filter((name) => !entries.includes(name)),
      totals: {
        files: files.length,
        bytes: files.reduce((n, f) => n + f.bytes, 0),
        orphans: orphaned.length,
        orphanBytes: orphaned.reduce((n, f) => n + f.bytes, 0),
        eligible: files.filter((f) => f.eligible).length,
        unsafe: unsafe.length,
      },
    }
  })
}
