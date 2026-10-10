import { NextResponse } from 'next/server'
import { STORED_NAME, readPhoto } from '@/lib/uploads'
import { requireIdentity } from '@/lib/identity'
import { sniffImageType } from '@/lib/image-types'

/**
 * Serve an uploaded contact avatar.
 *
 * ⚠️ WITHOUT THIS ROUTE, NO UPLOADED AVATAR IS EVER REACHABLE — in production
 * exactly as much as in dev. `next.config.ts` sets `output: 'standalone'`, and
 * standalone resolves `public/` through a manifest computed **at build time**.
 * Compose then mounts the uploads volume over `/app/public/uploads`, so a file
 * written by `POST /api/upload` is on disk, inside the public directory, and
 * absent from the only index the static handler consults. It 404s. The upload
 * succeeds, the database stores the URL, and the image never appears.
 *
 * That same fact is what makes this route unambiguous rather than a race with
 * the static handler: no uploaded file can be in the build manifest, so nothing
 * else will ever answer for one of these paths.
 *
 * The URL shape is `/uploads/<name>` because that is what `Contact.avatarUrl`
 * already holds, in this database and in production's. Serving a different
 * shape would need a data migration, which this is not.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Exactly what `POST /api/upload` and archive import write: a v4 UUID plus an
 * extension this app itself chose from sniffed bytes.
 *
 * ⚠️ An allowlist, not a traversal filter. `name` arrives from a URL, and a
 * denylist of `..` and `/` is a guess about every encoding an attacker might
 * reach for. This pattern cannot express a path at all — no separators, no
 * dots beyond the single extension one, fixed length.
 */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const owner = requireIdentity(req).subject
  const { name } = await params

  if (!STORED_NAME.test(name)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let bytes: Buffer
  try {
    bytes = await readPhoto(owner, name)
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // ⚠️ Content-Type from the BYTES, never from the extension — the same rule
  // `lib/image-types.ts` already imposes on both write paths (K08), applied
  // once more on the way out.
  //
  // The write paths make this redundant today and that is the point: this
  // directory is a mounted volume, so its contents are not solely a function of
  // this application's code. A file that arrived some other way is not served,
  // rather than served as whatever its name claimed.
  const sniffed = sniffImageType(bytes)
  if (!sniffed) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': sniffed,
      'Content-Length': String(bytes.byteLength),
      // Names are random and a stored file is never rewritten under the same
      // name -- an edited avatar is a new UUID and a new row value. Immutable
      // is therefore accurate, not optimistic.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
