import type { Metadata, Viewport } from 'next'
import { MobileShell } from '@/components/mobile/shell'

/**
 * iOS does not read the web app manifest for either of these, so being
 * installable to a Home Screen on an iPhone means stating them here as well.
 * `black-translucent` lets the page paint under the status bar, which is what
 * `viewport-fit: cover` and the safe-area insets below are for.
 */
export const metadata: Metadata = {
  appleWebApp: {
    capable: true,
    title: 'Kinship',
    statusBarStyle: 'black-translucent',
  },
  icons: { apple: '/icons/192' },
}

/**
 * `viewport-fit: cover` is the part that is not boilerplate: without it the
 * `env(safe-area-inset-*)` values the shell and the sheets read are all zero,
 * and the bottom tab bar ends up under the home indicator on a gesture-
 * navigation phone. Declared here rather than in the root layout because the
 * desktop tree neither needs it nor should get it.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f2eb' },
    { media: '(prefers-color-scheme: dark)', color: '#1e1c18' },
  ],
}

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return <MobileShell>{children}</MobileShell>
}
