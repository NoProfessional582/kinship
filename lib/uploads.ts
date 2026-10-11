import path from 'node:path'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, realpath, readdir, rm, writeFile } from 'node:fs/promises'
import { ALLOWED_IMAGE_TYPES, extensionFor, sniffImageType } from './image-types'
import { ValidationError } from './errors'

/**
 * Where contact avatars live. Backed by the `uploads` volume in compose, so it
 * survives `docker compose down` but is *not* in the database — which is the
 * whole reason the archive has to carry these files alongside the rows.
 *
 * Shared by the upload route, the archive service and the route that serves
 * these files back (`app/uploads/[name]/route.ts`), so the three can never
 * drift onto different directories.
 *
 * ⚠️ Being under `public/` does NOT mean Next serves it. `output: 'standalone'`
 * resolves `public/` from a build-time manifest, and nothing written here after
 * the build is in it. The path is kept because production's volume is already
 * mounted at it; serving is the route handler's job.
 */
// The released CLI lives in /app/cli and has an intentional ../public alias.
// Use the physical application root directly so both entry points share the
// same namespace without permitting symlinks in photo paths.
const appDirectory = process.cwd() === '/app/cli' ? '/app' : process.cwd()
export const UPLOAD_DIR = path.join(appDirectory, 'public', 'uploads')

/** Keep subjects out of filesystem paths while giving every owner a private namespace. */
export const ownerUploadDir = (owner: string) =>
  path.join(UPLOAD_DIR, createHash('sha256').update(owner).digest('hex'))

/** The public URL the app stores in `Contact.avatarUrl` for a saved file. */
export const uploadUrl = (name: string) => `/uploads/${name}`

/** The same allowlist used for serving, exporting and writing immutable photos. */
export const STORED_NAME = new RegExp(
  `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\.(?:${ALLOWED_IMAGE_TYPES.map(extensionFor).join('|')})$`,
)

export function localPhotoName(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith('/uploads')) return null
  const name = url.startsWith('/uploads/') ? url.slice('/uploads/'.length) : ''
  if (!STORED_NAME.test(name))
    throw new ValidationError(`Invalid local photo reference: ${url}. Nothing was changed.`)
  return name
}

export function photoPath(owner: string, name: string): string {
  if (!STORED_NAME.test(name)) throw new ValidationError(`Invalid stored photo name: ${name}`)
  const directory = path.resolve(ownerUploadDir(owner))
  const target = path.resolve(/*turbopackIgnore: true*/ directory, name)
  if (path.dirname(target) !== directory)
    throw new ValidationError('Photo path is outside its owner directory')
  return target
}

/** Reject symlinks in the directory chain as well as at the final filename. */
async function checkedDirectory(owner: string, create = false): Promise<void> {
  const directory = path.resolve(ownerUploadDir(owner))
  if (create) {
    // Check the root before mkdir can traverse an owner-directory symlink.
    await mkdir(UPLOAD_DIR, { recursive: true })
    if ((await realpath(UPLOAD_DIR)) !== path.resolve(UPLOAD_DIR))
      throw new ValidationError('The uploads directory must not contain symlinks')
    await mkdir(directory, { recursive: true })
  }
  if ((await realpath(directory)) !== directory)
    throw new ValidationError('The photo owner directory must not contain symlinks')
}

/** Caller holds the owner lock whenever a lifecycle operation can remove bytes. */
export async function readPhoto(owner: string, name: string, maxBytes = Infinity): Promise<Buffer> {
  const target = photoPath(owner, name)
  try {
    await checkedDirectory(owner)
    const file = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      const stat = await file.stat()
      if (!stat.isFile()) throw new Error('not a regular file')
      if (stat.size > maxBytes) throw new Error('image exceeds reuse size limit')
      const bytes = await file.readFile()
      if (!sniffImageType(bytes)) throw new Error('not a supported image')
      return bytes
    } finally {
      await file.close()
    }
  } catch (err) {
    throw new ValidationError(
      `Could not read referenced photo "${name}": ${err instanceof Error ? err.message : 'unknown error'}. Nothing was changed.`,
    )
  }
}

/** Exclusive creation never overwrites existing bytes, even on a UUID collision. */
export async function writePhoto(owner: string, name: string, bytes: Buffer): Promise<void> {
  const target = photoPath(owner, name)
  await checkedDirectory(owner, true)
  const file = await open(target, 'wx')
  try {
    await file.writeFile(bytes)
    await file.close()
  } catch (err) {
    await file.close().catch(() => {})
    await rm(target, { force: true })
    throw err
  }
}

/** Safe owner-local enumeration for verified restore reuse, never deletion. */
export async function listPhotos(owner: string): Promise<string[]> {
  try {
    await checkedDirectory(owner)
    return (await readdir(ownerUploadDir(owner))).filter((name) => STORED_NAME.test(name)).sort()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

/** Record a specific superseded reference; consumers must recheck its lifetime. */
export async function recordPhotoCandidate(owner: string, name: string): Promise<void> {
  photoPath(owner, name)
  await checkedDirectory(owner)
  await writeFile(
    path.join(ownerUploadDir(owner), `.candidate-${name}.json`),
    JSON.stringify({ name, reason: 'restore', recordedAt: Date.now() }),
    { flag: 'wx' },
  )
}
