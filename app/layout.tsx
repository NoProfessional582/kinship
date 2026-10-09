import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/components/shared/providers'

/**
 * Static on purpose. `appTitle` is editable in settings, but reading it here
 * would put a database query in the root layout and force every otherwise
 * static page to render on demand. The default is what the sidebar shows on a
 * fresh install, so this at least agrees with the app rather than naming
 * something that appears nowhere in it.
 *
 * The same reasoning is why nothing here reads a cookie or a user-agent to pick
 * between the desktop and mobile GUIs: `cookies()` would opt the whole app out
 * of static generation for a guess. The two trees are separate routes instead —
 * `app/(desktop)` and `app/m` — and the PWA's start_url points the phone at the
 * one it wants.
 */
export const metadata: Metadata = {
  title: 'Kinship',
  description: 'Personal knowledge base and relationship manager',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
