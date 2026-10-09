import path from 'node:path'
import { createHash } from 'node:crypto'

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
export const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads')

/** Keep subjects out of filesystem paths while giving every owner a private namespace. */
export const ownerUploadDir = (owner: string) =>
  path.join(UPLOAD_DIR, createHash('sha256').update(owner).digest('hex'))

/** The public URL the app stores in `Contact.avatarUrl` for a saved file. */
export const uploadUrl = (name: string) => `/uploads/${name}`
