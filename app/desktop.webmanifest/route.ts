import type { MetadataRoute } from 'next'
import mobileManifest from '../manifest'

/**
 * The desktop GUI's manifest. app/manifest.ts sends an installed app to `/m`,
 * which is right for a phone and wrong for "Install Kinship" in desktop Chrome:
 * the window would open the mobile GUI. So the desktop tree links this one
 * instead (app/(desktop)/layout.tsx), and the mobile tree keeps the default.
 *
 * Its own `id` makes it a separate app from the phone one, so a browser that
 * has installed one can still install the other. `scope` is `/`, which takes
 * in `/m` as well; that is harmless, since nothing on the desktop links there.
 * No `orientation`: a desktop window should not be locked to portrait.
 *
 * Next's file convention serves only one manifest, hence a route handler,
 * forced static so it costs no more than the file-based one.
 */
export const dynamic = 'force-static'

export function GET() {
  const manifest: MetadataRoute.Manifest = {
    ...mobileManifest(),
    id: '/',
    start_url: '/',
    scope: '/',
  }
  delete manifest.orientation
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json' },
  })
}
