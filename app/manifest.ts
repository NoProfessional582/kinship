import type { MetadataRoute } from 'next'

/**
 * The manifest is what makes the phone's home-screen icon open the *mobile*
 * GUI, and it is the reason this app needs no device detection anywhere:
 * `start_url` is `/m`, so the icon is the router. Nothing sniffs a user-agent,
 * so "Request Desktop Site" and an iPad's desktop UA are not failure modes to
 * handle — they never arise.
 *
 * `scope` is `/m` for the same reason. A link out to a desktop route then
 * opens in the browser rather than inside the installed app, which is the
 * correct behaviour: the desktop GUI is not laid out for this window.
 *
 * Static on purpose. `appTitle` is editable in settings, but reading it here
 * would put a database query in a file Next renders at build time, and an
 * installed app's name is fixed at install anyway — changing it later would
 * not rename an icon already on a home screen.
 *
 * No service worker: no offline, and none of the stale-cache-after-deploy
 * failure mode.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Kinship',
    short_name: 'Kinship',
    description: 'Personal knowledge base and relationship manager',
    start_url: '/m',
    scope: '/m',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f5f2eb',
    theme_color: '#f5f2eb',
    icons: [
      { src: '/icons/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/512-maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
