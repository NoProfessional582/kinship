import { NextResponse } from 'next/server'
import { archiveFilename, exportArchive } from '@/lib/services/archive'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The whole database plus the avatar files, as one JSON file to download.
 *
 * Not routed through `handle()` like the rest of the API: that helper always
 * answers `application/json` with no disposition, and the point of this route is
 * a file the browser saves rather than a payload it parses.
 */
export async function GET(req: Request) {
  try {
    const archive = await exportArchive(requireIdentity(req).subject)
    const at = new Date(archive.exportedAt)

    // Pretty-printed on purpose. It roughly doubles the file, which at this
    // scale is a few megabytes, and buys an archive you can open, read and diff
    // — which is most of what makes a plain-JSON export worth having over a
    // database dump in the first place.
    const body = JSON.stringify(archive, null, 2)

    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${archiveFilename(at)}"`,
        'Content-Length': String(Buffer.byteLength(body)),
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[export]', err)
    const message = err instanceof Error ? err.message : 'Export failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
