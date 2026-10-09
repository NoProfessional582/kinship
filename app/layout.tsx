import type { Metadata } from 'next'
import { DM_Mono, Manrope, Newsreader } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/shared/providers'

const bodyFont = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--kinship-body',
  display: 'swap',
})
const displayFont = Newsreader({
  subsets: ['latin'],
  weight: 'variable',
  axes: ['opsz'],
  variable: '--kinship-display',
  display: 'swap',
})
const monoFont = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--kinship-mono',
  display: 'swap',
})

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
    <html
      lang="en"
      className={`${bodyFont.variable} ${displayFont.variable} ${monoFont.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
