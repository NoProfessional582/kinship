'use client'
import * as React from 'react'
import { useBrowserReady } from '@/lib/hooks/platform'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  LayoutDashboard,
  NotebookPen,
  Users,
  KanbanSquare,
  CalendarDays,
  Search,
  Moon,
  Sun,
  FolderKanban,
  Orbit,
  Settings,
  Trash2,
  MoreHorizontal,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { m } from '@/lib/mobile/href'
import { useUi } from '@/lib/store'
import { CommandPalette } from '@/components/shared/command-palette'
import { EnrichmentQueue } from '@/components/entity-modal/enrichment-queue'
import { useFontScale, useSettings } from '@/lib/hooks/settings'
import { MSheet, MSheetContent, MSheetTitle } from '@/components/mobile/sheet'

/**
 * Five tabs, because a sixth stops being reachable by thumb on a 412px screen
 * and starts being a row of icons nobody can name. The rest live in the
 * overflow sheet, which is where things you visit deliberately belong —
 * settings, trash, the theme.
 */
const TABS = [
  { href: '/', label: 'Today', icon: LayoutDashboard, hue: 'var(--hue-1)' },
  { href: '/notes', label: 'Notes', icon: NotebookPen, hue: 'var(--hue-6)' },
  { href: '/contacts', label: 'People', icon: Users, hue: 'var(--hue-2)' },
  { href: '/board', label: 'Board', icon: KanbanSquare, hue: 'var(--hue-3)' },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays, hue: 'var(--hue-4)' },
]

const MORE = [
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/map', label: 'Map', icon: Orbit },
  { href: '/trash', label: 'Trash', icon: Trash2 },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function MobileShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const settings = useSettings()
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  const [moreOpen, setMoreOpen] = React.useState(false)
  useFontScale()

  // `/m` and `/m/notes` both start with `/m`, so the dashboard has to match
  // exactly or it would light up on every screen.
  const isActive = (href: string) =>
    href === '/' ? pathname === '/m' : pathname.startsWith(m(href))

  // The map fills the whole space between the bars, edge to edge, and a finger turns it
  // rather than scrolling the page.
  const fullBleed = pathname === m('/map')

  const [route, setRoute] = React.useState(pathname)
  if (route !== pathname) {
    setRoute(pathname)
    setMoreOpen(false)
  }

  return (
    <div className="kb-m flex h-dvh flex-col overflow-hidden bg-[var(--background)]">
      <header className="flex h-[var(--m-topbar)] shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--card)] px-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-sm font-bold text-white [background:linear-gradient(135deg,var(--hue-1),var(--hue-6))]">
          {settings.appTitle.slice(0, 1).toUpperCase()}
        </div>
        <span className="display min-w-0 flex-1 truncate text-[15px] font-semibold">
          {settings.appTitle}
        </span>
        <button
          onClick={() => setPaletteOpen(true)}
          aria-label="Search"
          className="kb-tap flex items-center justify-center rounded-[var(--radius-md)] text-[var(--muted-foreground)]"
        >
          <Search className="h-5 w-5" />
        </button>
        <button
          onClick={() => setMoreOpen(true)}
          aria-label="More"
          className="kb-tap flex items-center justify-center rounded-[var(--radius-md)] text-[var(--muted-foreground)]"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </header>

      {/* The scroll container is this element, not the document, so the top bar
          and the tab bar stay fixed without `position: fixed` and its habit of
          jumping around when a mobile keyboard opens. */}
      <main
        className={cn(
          'min-h-0 flex-1',
          fullBleed ? 'overflow-hidden' : 'overflow-y-auto overscroll-y-contain',
        )}
      >
        {fullBleed ? children : <div className="kb-m-page px-4 pb-6 pt-4">{children}</div>}
      </main>

      <nav
        className="flex shrink-0 items-stretch border-t border-[var(--border)] bg-[var(--card)]"
        style={{ height: 'var(--m-bottom)', paddingBottom: 'var(--safe-b)' }}
      >
        {TABS.map((t) => {
          const active = isActive(t.href)
          return (
            <Link
              key={t.href}
              href={m(t.href)}
              className="flex flex-1 flex-col items-center justify-center gap-0.5"
              style={active ? { color: t.hue } : undefined}
              aria-current={active ? 'page' : undefined}
            >
              <t.icon className={cn('h-5 w-5', !active && 'text-[var(--muted-foreground)]')} />
              <span
                className={cn(
                  'text-[10px] leading-none',
                  active ? 'font-semibold' : 'text-[var(--muted-foreground)]',
                )}
              >
                {t.label}
              </span>
            </Link>
          )
        })}
      </nav>

      <MSheet open={moreOpen} onOpenChange={setMoreOpen}>
        <MSheetContent hideClose>
          <MSheetTitle className="px-4 pb-1 pt-1 text-sm font-semibold">More</MSheetTitle>
          <div className="flex flex-col px-2 pb-3">
            {MORE.map((item) => (
              <Link
                key={item.href}
                href={m(item.href)}
                className="kb-tap flex items-center gap-3 rounded-[var(--radius-md)] px-3 text-sm"
              >
                <item.icon className="h-4 w-4 text-[var(--muted-foreground)]" />
                {item.label}
              </Link>
            ))}
            <ThemeRow />
            <div className="mt-2 flex items-center gap-2 px-3 pt-2 text-[11px] text-[var(--muted-foreground)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
              <span className="truncate">{settings.userName}</span>
              <span className="flex-1" />
              <button
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="kb-tap flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </MSheetContent>
      </MSheet>

      <CommandPalette phone />
      <EnrichmentQueue />
    </div>
  )
}

function ThemeRow() {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useBrowserReady()
  const dark = mounted && resolvedTheme === 'dark'

  return (
    <button
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className="kb-tap flex items-center gap-3 rounded-[var(--radius-md)] px-3 text-left text-sm"
    >
      {dark ? (
        <Sun className="h-4 w-4 text-[var(--muted-foreground)]" />
      ) : (
        <Moon className="h-4 w-4 text-[var(--muted-foreground)]" />
      )}
      {dark ? 'Light theme' : 'Dark theme'}
    </button>
  )
}
